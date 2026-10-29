import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import {
  db, postsTable, postMediaTable, reelsTable, storiesTable, commentsTable, liveStreamsTable,
  usersTable, notificationsTable,
} from "@workspace/db";
import { deleteFile, deletePrivate, getStorageKeyFromPublicUrl, isPaidKey } from "./storage";
import { suspenderConta, desligarSocketsDepois } from "./suspensao";
import { temMenorAberta } from "./provaProtegida";

/**
 * Retirada de conteúdo (takedown) e denúncias.
 *
 * Retirar = ESCONDER (retirado_em / retirado_motivo / retirado_por). Nada é apagado e os ficheiros no
 * Bunny ficam retidos; só `apagarFicheiros` (ação explícita e auditada do admin) os remove.
 * Perfil: "retirar" = suspender a conta (users.ativo = false), que já é reversível.
 */

export const TARGET_TYPES = ["post", "reel", "story", "comment", "user", "live"] as const;
export type TargetType = typeof TARGET_TYPES[number];

export const REPORT_REASONS = ["menor", "sem_consentimento", "direitos_autor", "violencia", "assedio", "spam", "conteudo_mais18_nao_marcado", "outro"] as const;
export type ReportReason = typeof REPORT_REASONS[number];

/** E-mail de contacto para denúncias (configurável por REPORTS_CONTACT_EMAIL). */
export const REPORTS_CONTACT_EMAIL = process.env.REPORTS_CONTACT_EMAIL || "legal@xclusive.ao";

export const TARGET_LABEL: Record<TargetType, string> = {
  post: "publicação", reel: "reel", story: "story", comment: "comentário", user: "perfil", live: "live",
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Q = Tx | typeof db;

// ── Condições de leitura: TODAS as queries que servem conteúdo usam estas (excluem retirados e autores suspensos) ──
const autorAtivo = (col: unknown): SQL => sql`${col} IN (SELECT id FROM users WHERE ativo)`;
export const postVisivel = (): SQL => and(isNull(postsTable.retiradoEm), autorAtivo(postsTable.autorId))!;
export const reelVisivel = (): SQL => and(isNull(reelsTable.retiradoEm), autorAtivo(reelsTable.autorId))!;
export const storyVisivel = (): SQL => and(isNull(storiesTable.retiradoEm), autorAtivo(storiesTable.autorId))!;
export const commentVisivel = (): SQL => and(isNull(commentsTable.retiradoEm), autorAtivo(commentsTable.autorId))!;
export const liveVisivel = (): SQL => and(isNull(liveStreamsTable.retiradoEm), autorAtivo(liveStreamsTable.criadorId))!;

export interface TargetInfo {
  ownerId: number;
  removido: boolean;
  /** Texto curto do alvo (legenda/comentário/nome) para o admin. */
  resumo: string | null;
  /** URLs guardados do média (chave "paid/..." ou URL público). */
  media: { tipo: string; url: string }[];
  ownerRole?: string;
  /** Marcação +18 (post, reel, story e live). */
  mais18?: boolean;
  /** Story cuja validade já passou. */
  expirada?: boolean;
  /** Data de criação do alvo (para o snapshot da denúncia). */
  criadoEm?: Date;
}

/** Lê o alvo (existência, dono, estado, resumo e média). null se não existir. */
export async function lerAlvo(q: Q, type: TargetType, id: number): Promise<TargetInfo | null> {
  switch (type) {
    case "post": {
      const [p] = await q.select().from(postsTable).where(eq(postsTable.id, id)).limit(1);
      if (!p) return null;
      const media = await q.select().from(postMediaTable).where(eq(postMediaTable.postId, id)).orderBy(postMediaTable.ordem);
      return { ownerId: p.autorId, removido: !!p.retiradoEm, resumo: p.legenda, media: media.map((m) => ({ tipo: m.tipo, url: m.url })), mais18: p.mais18, criadoEm: p.criadoEm };
    }
    case "reel": {
      const [r] = await q.select().from(reelsTable).where(eq(reelsTable.id, id)).limit(1);
      if (!r) return null;
      return { ownerId: r.autorId, removido: !!r.retiradoEm, resumo: r.legenda, media: [{ tipo: "video", url: r.videoUrl }], mais18: r.mais18, criadoEm: r.criadoEm };
    }
    case "story": {
      const [s] = await q.select().from(storiesTable).where(eq(storiesTable.id, id)).limit(1);
      if (!s) return null;
      return { ownerId: s.autorId, removido: !!s.retiradoEm, resumo: null, media: [{ tipo: s.tipo === "video" ? "video" : "imagem", url: s.mediaUrl }], mais18: s.mais18, expirada: s.expiraEm < new Date(), criadoEm: s.criadoEm };
    }
    case "comment": {
      const [c] = await q.select().from(commentsTable).where(eq(commentsTable.id, id)).limit(1);
      if (!c) return null;
      return { ownerId: c.autorId, removido: !!c.retiradoEm, resumo: c.texto, media: [], criadoEm: c.criadoEm };
    }
    case "live": {
      const [l] = await q.select().from(liveStreamsTable).where(eq(liveStreamsTable.id, id)).limit(1);
      if (!l) return null;
      return { ownerId: l.criadorId, removido: !!l.retiradoEm, resumo: null, media: [], mais18: l.mais18, criadoEm: l.criadoEm };
    }
    case "user": {
      const [u] = await q.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
      if (!u) return null;
      return { ownerId: u.id, removido: !u.ativo, resumo: `@${u.username}`, media: [], ownerRole: u.role, criadoEm: u.criadoEm };
    }
  }
}

/**
 * Retira (esconde) o alvo. Idempotente: devolve `mudou=false` se já estava retirado.
 * Perfil → suspende a conta (recusa contas admin/superadmin). Live → termina a transmissão.
 * NÃO apaga ficheiros.
 */
export async function retirarAlvo(tx: Tx, type: TargetType, id: number, porAdminId: number | null, motivo: string): Promise<{ mudou: boolean }> {
  const marca = { retiradoEm: new Date(), retiradoMotivo: motivo.slice(0, 500), retiradoPor: porAdminId };
  switch (type) {
    case "post": return { mudou: (await tx.update(postsTable).set(marca).where(and(eq(postsTable.id, id), isNull(postsTable.retiradoEm))).returning({ id: postsTable.id })).length > 0 };
    case "reel": return { mudou: (await tx.update(reelsTable).set(marca).where(and(eq(reelsTable.id, id), isNull(reelsTable.retiradoEm))).returning({ id: reelsTable.id })).length > 0 };
    case "story": return { mudou: (await tx.update(storiesTable).set(marca).where(and(eq(storiesTable.id, id), isNull(storiesTable.retiradoEm))).returning({ id: storiesTable.id })).length > 0 };
    case "comment": return { mudou: (await tx.update(commentsTable).set(marca).where(and(eq(commentsTable.id, id), isNull(commentsTable.retiradoEm))).returning({ id: commentsTable.id })).length > 0 };
    case "live": return { mudou: (await tx.update(liveStreamsTable).set({ ...marca, status: "terminado", terminadoEm: new Date() }).where(and(eq(liveStreamsTable.id, id), isNull(liveStreamsTable.retiradoEm))).returning({ id: liveStreamsTable.id })).length > 0 };
    case "user": {
      const [u] = await tx.select({ role: usersTable.role, ativo: usersTable.ativo }).from(usersTable).where(eq(usersTable.id, id)).limit(1);
      if (!u) return { mudou: false };
      if (u.role === "admin" || u.role === "superadmin") throw new TakedownError("Não é possível suspender uma conta de administrador.", 403);
      // Suspensão partilhada: ativo=false + revoga sessões e refresh tokens (+ audit); sockets desligam-se após o commit.
      const r = await suspenderConta(tx, id, { adminId: porAdminId, origem: "denuncia" });
      desligarSocketsDepois(id);
      return { mudou: r.mudou };
    }
  }
}

/** Repõe o alvo (desfaz a retirada). Live fica terminada; perfil volta a ativo. */
export async function restaurarAlvo(tx: Tx, type: TargetType, id: number): Promise<{ mudou: boolean }> {
  // Com uma denúncia de menor por decidir, o conteúdo não volta a ficar visível.
  if (await temMenorAberta(tx, type, id)) {
    throw new TakedownError("Há uma denúncia de menor por decidir sobre este conteúdo: não pode ser reposto enquanto a denúncia não estiver decidida e arquivada.", 409);
  }
  const limpa = { retiradoEm: null, retiradoMotivo: null, retiradoPor: null };
  switch (type) {
    case "post": return { mudou: (await tx.update(postsTable).set(limpa).where(eq(postsTable.id, id)).returning({ id: postsTable.id })).length > 0 };
    case "reel": return { mudou: (await tx.update(reelsTable).set(limpa).where(eq(reelsTable.id, id)).returning({ id: reelsTable.id })).length > 0 };
    case "story": return { mudou: (await tx.update(storiesTable).set(limpa).where(eq(storiesTable.id, id)).returning({ id: storiesTable.id })).length > 0 };
    case "comment": return { mudou: (await tx.update(commentsTable).set(limpa).where(eq(commentsTable.id, id)).returning({ id: commentsTable.id })).length > 0 };
    case "live": return { mudou: (await tx.update(liveStreamsTable).set(limpa).where(eq(liveStreamsTable.id, id)).returning({ id: liveStreamsTable.id })).length > 0 };
    case "user": {
      // Conta encerrada pelo próprio: não se repõe por aqui (só "Reabrir conta" no admin).
      const [u] = await tx.select({ encerradaEm: usersTable.encerradaEm, banidaEm: usersTable.banidaEm }).from(usersTable).where(eq(usersTable.id, id)).limit(1);
      if (u?.banidaEm) throw new TakedownError("Esta conta está banida de forma permanente: não se repõe.", 409);
      if (u?.encerradaEm) throw new TakedownError("Esta conta foi encerrada pelo próprio utilizador: não se repõe por aqui.", 409);
      return { mudou: (await tx.update(usersTable).set({ ativo: true }).where(eq(usersTable.id, id)).returning({ id: usersTable.id })).length > 0 };
    }
  }
}

/**
 * Apaga os FICHEIROS do alvo no Bunny (privado "paid/..." e público). Só para ser chamado por uma ação
 * explícita e auditada do admin, e apenas sobre conteúdo já retirado. Não toca nas linhas da BD.
 */
export async function apagarFicheiros(media: { url: string }[]): Promise<{ apagados: number; falhas: number; ignorados: number }> {
  let apagados = 0, falhas = 0, ignorados = 0;
  for (const m of media) {
    try {
      if (isPaidKey(m.url)) { await deletePrivate(m.url); apagados++; continue; }
      const key = getStorageKeyFromPublicUrl(m.url);
      if (!key) { ignorados++; continue; }
      await deleteFile(key); apagados++;
    } catch { falhas++; }
  }
  return { apagados, falhas, ignorados };
}

/** Notificação do sistema (sem ator e sem alvo: não revela quem denunciou nem liga ao conteúdo retirado). */
export async function notificarSistema(tx: Tx, destinatarioId: number, mensagem: string): Promise<void> {
  await tx.insert(notificationsTable).values({ destinatarioId, tipo: "sistema", mensagem: mensagem.slice(0, 1000) });
}

/**
 * Notificação 'sistema' para TODOS os admins ativos (role admin|superadmin), na transação recebida.
 * `alvoId` = id da denúncia. Devolve quantos admins foram notificados.
 */
export async function notificarAdmins(tx: Tx, mensagem: string, alvoId: number): Promise<number> {
  const admins = await tx.select({ id: usersTable.id }).from(usersTable)
    .where(and(inArray(usersTable.role, ["admin", "superadmin"]), eq(usersTable.ativo, true)));
  if (admins.length === 0) return 0;
  await tx.insert(notificationsTable).values(
    admins.map((a) => ({ destinatarioId: a.id, tipo: "sistema" as const, alvoId, mensagem: mensagem.slice(0, 1000) })),
  );
  return admins.length;
}

export class TakedownError extends Error {
  constructor(msg: string, public readonly httpStatus: number) {
    super(msg);
    this.name = "TakedownError";
  }
}
