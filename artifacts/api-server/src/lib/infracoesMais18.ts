import { and, count, eq, inArray, isNull } from "drizzle-orm";
import {
  db, usersTable, postsTable, reelsTable, storiesTable, liveStreamsTable, auditLogTable, infracoesMais18Table,
} from "@workspace/db";
import { lerAlvo, notificarSistema, TakedownError } from "./takedown";
import { suspenderConta, desligarSockets } from "./suspensao";
import { desligarSocketsDaLiveMais18 } from "./socket";

/**
 * Infrações da regra do +18 (PR A). Quando o admin marca como +18 conteúdo que a criadora NÃO tinha marcado
 * (`infracao: true`) regista-se uma infração: 1.ª e 2.ª = aviso; da 3.ª em diante (n >= 3) = suspensão.
 * Os avisos não caducam; só o admin as anula (ficam registadas e deixam de contar).
 *
 * `marcarMais18PorAdmin` e `anularInfracao` correm DENTRO da transação do chamador e fazem TUDO nela:
 * marca, infração, notificação, suspensão e audit_log. Se qualquer passo falhar, nada fica feito.
 * Os efeitos fora da base de dados (desligar sockets) fazem-se DEPOIS do commit, em `efeitosAposCommit`.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const TIPOS_MAIS18 = ["post", "reel", "story", "live"] as const;
export type TipoMais18 = typeof TIPOS_MAIS18[number];
export const isTipoMais18 = (t: string): t is TipoMais18 => (TIPOS_MAIS18 as readonly string[]).includes(t);

/** A partir da N-ésima infração ativa a conta é suspensa (4.ª em diante suspende de novo). */
export const INFRACAO_LIMITE_SUSPENSAO = 3;

export interface ResultadoMarcacao {
  /** A marcação mudou (false = já estava no estado pedido: nada foi feito). */
  mudou: boolean;
  ownerId: number;
  tipo: TipoMais18;
  conteudoId: number;
  /** Infração registada (só se `infracao: true` foi aplicável). */
  infracao: { id: number; numero: number; acao: "aviso" | "suspensao" } | null;
  /** Porque não se registou infração, quando foi pedida/esperada. */
  semInfracaoPorque: "correcao" | "ja_marcado" | "infracao_ja_ativa" | null;
  suspendeu: boolean;
  /** Ao desmarcar: infração ativa deste conteúdo (o admin pode anulá-la em separado). */
  infracaoAtivaId: number | null;
}

/** Mensagens de aviso à criadora. Sem dados sensíveis: não dizem quem agiu nem quem denunciou. */
const ARTIGO: Record<TipoMais18, { det: string; marcado: string }> = {
  post: { det: "a tua publicação", marcado: "marcada" },
  reel: { det: "o teu reel", marcado: "marcado" },
  story: { det: "o teu story", marcado: "marcado" },
  live: { det: "a tua live", marcado: "marcada" },
};
export function textoAvisoInfracao(tipo: TipoMais18, numero: number): string {
  const a = ARTIGO[tipo];
  if (numero >= INFRACAO_LIMITE_SUSPENSAO) return "A tua conta foi suspensa por infrações repetidas à regra do conteúdo +18.";
  const resto = numero === 1
    ? "Na 3.ª infração a conta é suspensa."
    : "A próxima infração suspende a conta.";
  return `Aviso ${numero} de ${INFRACAO_LIMITE_SUSPENSAO}: ${a.det} não estava marcad${a.marcado.slice(-1)} como +18 e foi ${a.marcado} pela equipa. Marca sempre o conteúdo +18 ao publicar. ${resto}`;
}

/** Atualização compare-and-set da marcação: devolve true se a linha mudou de `de` para `para`. */
async function trocarMarca(tx: Tx, tipo: TipoMais18, id: number, de: boolean, para: boolean): Promise<boolean> {
  switch (tipo) {
    case "post": return (await tx.update(postsTable).set({ mais18: para }).where(and(eq(postsTable.id, id), eq(postsTable.mais18, de))).returning({ id: postsTable.id })).length > 0;
    case "reel": return (await tx.update(reelsTable).set({ mais18: para }).where(and(eq(reelsTable.id, id), eq(reelsTable.mais18, de))).returning({ id: reelsTable.id })).length > 0;
    case "story": return (await tx.update(storiesTable).set({ mais18: para }).where(and(eq(storiesTable.id, id), eq(storiesTable.mais18, de))).returning({ id: storiesTable.id })).length > 0;
    case "live": return (await tx.update(liveStreamsTable).set({ mais18: para }).where(and(eq(liveStreamsTable.id, id), eq(liveStreamsTable.mais18, de))).returning({ id: liveStreamsTable.id })).length > 0;
  }
}

async function infracaoAtivaDe(q: Tx | typeof db, tipo: TipoMais18, id: number) {
  const [i] = await q.select({ id: infracoesMais18Table.id }).from(infracoesMais18Table)
    .where(and(eq(infracoesMais18Table.tipoConteudo, tipo), eq(infracoesMais18Table.conteudoId, id), isNull(infracoesMais18Table.anuladaEm))).limit(1);
  return i?.id ?? null;
}

/** Nº de infrações ATIVAS da criadora (as anuladas não contam). */
export async function contarInfracoesAtivas(q: Tx | typeof db, userId: number): Promise<number> {
  const [{ n }] = await q.select({ n: count() }).from(infracoesMais18Table)
    .where(and(eq(infracoesMais18Table.userId, userId), isNull(infracoesMais18Table.anuladaEm)));
  return Number(n);
}

export async function marcarMais18PorAdmin(tx: Tx, p: {
  adminId: number;
  ip?: string | null;
  tipo: TipoMais18;
  conteudoId: number;
  mais18: boolean;
  /** true = "a criadora não marcou" (regista infração); false = correção do admin (sem infração, sem notificação). */
  infracao: boolean;
  motivo?: string | null;
  reportId?: number | null;
  origem?: "admin" | "denuncia";
}): Promise<ResultadoMarcacao> {
  const alvo = await lerAlvo(tx, p.tipo, p.conteudoId);
  if (!alvo) throw new TakedownError("Conteúdo não encontrado", 404);
  const ownerId = alvo.ownerId;
  const motivo = p.motivo ? p.motivo.slice(0, 300) : null;
  const base = { mudou: false, ownerId, tipo: p.tipo, conteudoId: p.conteudoId, infracao: null, semInfracaoPorque: null, suspendeu: false, infracaoAtivaId: null } as ResultadoMarcacao;

  // 1. Lock da criadora: serializa TODOS os admins que agem sobre esta criadora (contagem sem corridas).
  //    Ordem de locks fixa (criadora → conteúdo), logo sem deadlocks.
  const [dono] = await tx.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, ownerId)).for("update");
  if (!dono) throw new TakedownError("Criadora não encontrada", 404);

  // ── Desmarcar ──
  if (!p.mais18) {
    const mudou = await trocarMarca(tx, p.tipo, p.conteudoId, true, false);
    const ativa = await infracaoAtivaDe(tx, p.tipo, p.conteudoId);
    if (mudou) {
      await tx.insert(auditLogTable).values({
        adminId: p.adminId, action: "mais18_desmarcado_admin", targetType: p.tipo, targetId: p.conteudoId,
        details: { ownerId, motivo, infracaoAtivaId: ativa }, ipAddress: p.ip ?? null,
      });
    }
    return { ...base, mudou, infracaoAtivaId: ativa };
  }

  // ── Marcar ──
  // Infração só se a criadora é uma conta normal e o conteúdo está vivo; senão só correção (409, o admin escolhe).
  if (p.infracao) {
    const motivoBloqueio = dono.role === "admin" || dono.role === "superadmin" ? "conta de administrador"
      : alvo.removido ? "conteúdo retirado"
      : alvo.expirada ? "story expirada"
      : null;
    if (motivoBloqueio) {
      throw new TakedownError(`Não se regista infração (${motivoBloqueio}): usa a correção (infracao: false).`, 409);
    }
  }

  const mudou = await trocarMarca(tx, p.tipo, p.conteudoId, false, true);
  if (!mudou) return { ...base, semInfracaoPorque: "ja_marcado" }; // já estava marcado: nada a fazer, sem infração

  await tx.insert(auditLogTable).values({
    adminId: p.adminId, action: "mais18_marcado_admin", targetType: p.tipo, targetId: p.conteudoId,
    details: { ownerId, infracaoPedida: p.infracao, motivo, reportId: p.reportId ?? null }, ipAddress: p.ip ?? null,
  });
  if (!p.infracao) return { ...base, mudou: true, semInfracaoPorque: "correcao" };

  // Uma infração ativa por conteúdo: se já existe (admin desmarcou sem anular), não conta outra vez.
  const jaAtiva = await infracaoAtivaDe(tx, p.tipo, p.conteudoId);
  if (jaAtiva) return { ...base, mudou: true, semInfracaoPorque: "infracao_ja_ativa", infracaoAtivaId: jaAtiva };

  // 2. Contagem DEPOIS do lock: o 2.º admin vê o que o 1.º gravou; não duplica nem salta a 3.ª.
  const numero = (await contarInfracoesAtivas(tx, ownerId)) + 1;
  const acao = numero >= INFRACAO_LIMITE_SUSPENSAO ? "suspensao" : "aviso";
  const [inf] = await tx.insert(infracoesMais18Table).values({
    userId: ownerId, tipoConteudo: p.tipo, conteudoId: p.conteudoId, adminId: p.adminId,
    reportId: p.reportId ?? null, origem: p.origem ?? "admin", numero, acao, motivo,
  }).returning({ id: infracoesMais18Table.id });

  await tx.insert(auditLogTable).values({
    adminId: p.adminId, action: "mais18_infracao", targetType: "user", targetId: ownerId,
    details: { infracaoId: inf.id, numero, acao, conteudo: { tipo: p.tipo, id: p.conteudoId }, reportId: p.reportId ?? null, origem: p.origem ?? "admin" },
    ipAddress: p.ip ?? null,
  });
  await notificarSistema(tx, ownerId, textoAvisoInfracao(p.tipo, numero));

  let suspendeu = false;
  if (acao === "suspensao") {
    // Função partilhada: ativo=false + sessões e refresh tokens revogados (+ audit user_sessions_revoked).
    const r = await suspenderConta(tx, ownerId, { adminId: p.adminId, ip: p.ip ?? null, origem: "infracao_mais18" });
    suspendeu = true;
    if (r.mudou) {
      await tx.insert(auditLogTable).values({
        adminId: p.adminId, action: "user_suspend", targetType: "user", targetId: ownerId,
        details: { origem: "infracao_mais18", infracaoId: inf.id, numero }, ipAddress: p.ip ?? null,
      });
    }
  }
  return { ...base, mudou: true, infracao: { id: inf.id, numero, acao }, suspendeu };
}

/** Anula uma infração (fica registada, deixa de contar). Não reativa a conta: isso é uma ação à parte do admin. */
export async function anularInfracao(tx: Tx, p: { adminId: number; ip?: string | null; infracaoId: number; motivo: string }): Promise<{ userId: number; ativasDepois: number }> {
  const [peek] = await tx.select({ userId: infracoesMais18Table.userId }).from(infracoesMais18Table).where(eq(infracoesMais18Table.id, p.infracaoId)).limit(1);
  if (!peek) throw new TakedownError("Infração não encontrada", 404);
  // Mesma ordem de locks: criadora primeiro, infração depois.
  await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, peek.userId)).for("update");
  const [inf] = await tx.select().from(infracoesMais18Table).where(eq(infracoesMais18Table.id, p.infracaoId)).for("update");
  if (inf.anuladaEm) throw new TakedownError("Esta infração já foi anulada.", 409);
  await tx.update(infracoesMais18Table).set({ anuladaEm: new Date(), anuladaPor: p.adminId, anuladaMotivo: p.motivo.slice(0, 300) })
    .where(eq(infracoesMais18Table.id, p.infracaoId));
  const ativasDepois = await contarInfracoesAtivas(tx, inf.userId);
  await tx.insert(auditLogTable).values({
    adminId: p.adminId, action: "mais18_infracao_anulada", targetType: "user", targetId: inf.userId,
    details: { infracaoId: inf.id, numero: inf.numero, conteudo: { tipo: inf.tipoConteudo, id: inf.conteudoId }, motivo: p.motivo.slice(0, 300), ativasDepois },
    ipAddress: p.ip ?? null,
  });
  return { userId: inf.userId, ativasDepois };
}

/** DEPOIS do commit: desliga a criadora suspensa e, numa live marcada em direto, os espectadores sem direito. */
export function efeitosAposCommit(r: ResultadoMarcacao, mais18: boolean): void {
  if (r.suspendeu) desligarSockets(r.ownerId);
  if (mais18 && r.mudou && r.tipo === "live") void desligarSocketsDaLiveMais18(r.conteudoId);
}

/** Conteúdos de um tipo (de entre `ids`) com infração ativa: a criadora não os pode desmarcar. */
export async function comInfracaoAtiva(q: Tx | typeof db, tipo: TipoMais18, ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const rows = await q.select({ id: infracoesMais18Table.conteudoId }).from(infracoesMais18Table)
    .where(and(eq(infracoesMais18Table.tipoConteudo, tipo), inArray(infracoesMais18Table.conteudoId, ids), isNull(infracoesMais18Table.anuladaEm)));
  return new Set(rows.map((r) => r.id));
}

/** Posts (de entre `ids`) com infração ativa (atalho de `comInfracaoAtiva`). */
export const postsComInfracaoAtiva = (q: Tx | typeof db, ids: number[]): Promise<Set<number>> => comInfracaoAtiva(q, "post", ids);

