import { and, asc, desc, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";
import { auditLogTable, db, menorCasesTable, messagesTable, messageTipsTable, reportsTable, usersTable } from "@workspace/db";
import { restaurarAlvo, TakedownError } from "./takedown";
import { temMenorProcedente } from "./provaProtegida";
import { copiarImagemParaProvas, deletePrivate, getStorageKeyFromPublicUrl, isStorageConfigured } from "./storage";

/**
 * Denúncia de mensagem: prova congelada da conversa. Janela de contexto de até JANELA mensagens antes e depois da denunciada, de AMBOS os
 * lados (papel 'denunciado' = autor da mensagem denunciada; 'denunciante' = o outro participante). As imagens da janela são copiadas para a
 * zona privada (provas/<denúncia>/…) com SHA-256 e tamanho, para a prova não depender do ficheiro original. As gorjetas levam só
 * { valor, comissao, purchaseId } (nunca saldos). Só o tipo 'mensagem' usa este snapshot: o dos outros tipos não muda.
 */
export const JANELA_CONTEXTO = 20;

type CopiaEstado = "ok" | "falhou" | "nao_aplicavel";

export interface ProvaMensagem {
  snapshot: Record<string, unknown>;
  /** Chaves privadas copiadas (para limpar se a denúncia não chegar a ser criada). */
  copias: string[];
}

export async function prepararProvaMensagem(p: { conversationId: number; mensagemId: number; donoId: number; reportId: number }): Promise<ProvaMensagem> {
  const colunas = { m: messagesTable, valorGorjeta: messageTipsTable.valor, comissaoGorjeta: messageTipsTable.comissao, purchaseId: messageTipsTable.purchaseId };
  const base = () => db.select(colunas).from(messagesTable).leftJoin(messageTipsTable, eq(messageTipsTable.messageId, messagesTable.id));
  const [antes, principal, depois] = await Promise.all([
    base().where(and(eq(messagesTable.conversationId, p.conversationId), lt(messagesTable.id, p.mensagemId))).orderBy(desc(messagesTable.id)).limit(JANELA_CONTEXTO),
    base().where(and(eq(messagesTable.conversationId, p.conversationId), eq(messagesTable.id, p.mensagemId))).limit(1),
    base().where(and(eq(messagesTable.conversationId, p.conversationId), gt(messagesTable.id, p.mensagemId))).orderBy(asc(messagesTable.id)).limit(JANELA_CONTEXTO),
  ]);
  const janela = [...antes.reverse(), ...principal, ...depois];

  const copias: string[] = [];
  let falhou = false, haImagens = false;
  const mensagens: Record<string, unknown>[] = [];
  for (const { m, valorGorjeta, comissaoGorjeta, purchaseId } of janela) {
    const item: Record<string, unknown> = {
      id: m.id,
      autorId: m.autorId,
      papel: m.autorId === p.donoId ? "denunciado" : "denunciante",
      tipo: m.tipo,
      conteudo: m.conteudo,
      criadoEm: m.criadoEm.toISOString(),
      retirada: m.retiradoEm !== null,
      principal: m.id === p.mensagemId,
    };
    if (m.tipo === "imagem" && m.mediaUrl) {
      haImagens = true;
      const chaveOriginal = isStorageConfigured() ? getStorageKeyFromPublicUrl(m.mediaUrl) : null;
      const c = chaveOriginal ? await copiarImagemParaProvas(p.reportId, chaveOriginal) : ({ ok: false, motivo: "origem_indisponivel" } as const);
      if (c.ok) { copias.push(c.chaveCopia); item.imagem = { chaveOriginal, chaveCopia: c.chaveCopia, sha256: c.sha256, bytes: c.bytes, copiaEstado: "ok" satisfies CopiaEstado }; }
      else { falhou = true; item.imagem = { chaveOriginal, chaveCopia: null, sha256: null, bytes: null, copiaEstado: "falhou" satisfies CopiaEstado, motivo: c.motivo }; }
    }
    if (m.tipo === "gorjeta" && valorGorjeta != null) {
      item.gorjeta = { valor: Number(valorGorjeta), comissao: Number(comissaoGorjeta), purchaseId };
    }
    mensagens.push(item);
  }

  const copiaEstado: CopiaEstado = !haImagens ? "nao_aplicavel" : falhou ? "falhou" : "ok";
  const dono = principal[0]?.m;
  return {
    copias,
    snapshot: {
      tipo: "mensagem", id: p.mensagemId, donoId: p.donoId, conversaId: p.conversationId, mensagemId: p.mensagemId,
      resumo: null,
      ficheiros: copias.map((chave) => ({ tipo: "imagem", chave })),
      mais18: null,
      criadoEmConteudo: dono ? dono.criadoEm.toISOString() : null,
      capturadoEm: new Date().toISOString(),
      copiaEstado,
      janela: { antes: antes.length, depois: depois.length, maximo: JANELA_CONTEXTO },
      mensagens,
    },
  };
}

/** Apaga as cópias de prova (só quando a denúncia não chegou a ser criada). Melhor esforço: nunca lança. */
export async function apagarCopiasDeProva(chaves: string[]): Promise<void> {
  for (const k of chaves) { try { await deletePrivate(k); } catch { /* melhor esforço */ } }
}

/**
 * Excerto para o admin: SÓ o que está no snapshot congelado (nunca a conversa viva), com as imagens de prova por URL assinado de curta
 * duração. Não há (nem pode haver) forma de ler mensagens fora da janela.
 */
export function excertoParaAdmin(snapshot: unknown, assinar: (chave: string) => string | null): Record<string, unknown> | null {
  const s = snapshot as { conversaId?: number; mensagemId?: number; copiaEstado?: string; janela?: unknown; mensagens?: Record<string, any>[] } | null;
  if (!s || !Array.isArray(s.mensagens)) return null;
  return {
    conversaId: s.conversaId, mensagemId: s.mensagemId, copiaEstado: s.copiaEstado, janela: s.janela,
    mensagens: s.mensagens.map((m) => ({
      ...m,
      ...(m.imagem ? { imagem: { ...m.imagem, provaUrl: m.imagem.chaveCopia ? assinar(m.imagem.chaveCopia) : null } } : {}),
    })),
  };
}


// ── Reposição de uma mensagem retirada ───────────────────────────────────────────────────────────────────────
// A reposição só limpa a marca de retirada da mensagem (retirado_*): as cópias de prova e o snapshot da denúncia NÃO se tocam.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Q = Tx | typeof db;

export type ImpedimentoRepor = "nao_retirada" | "por_decidir" | "menor_procedente" | "caso_menor" | "outra_denuncia";
const TEXTO_IMPEDIMENTO: Record<ImpedimentoRepor, string> = {
  nao_retirada: "A mensagem não está retirada (já foi reposta ou nunca foi retirada).",
  por_decidir: "Decide primeiro a denúncia: só se repõe uma mensagem depois de a denúncia estar decidida.",
  menor_procedente: "Há uma denúncia de menor julgada procedente sobre esta mensagem: não pode ser reposta.",
  caso_menor: "Há um caso de menor aberto ou confirmado associado a esta mensagem: não pode ser reposta.",
  outra_denuncia: "Há outra denúncia aberta ou procedente sobre esta mesma mensagem: não pode ser reposta.",
};

export interface RetiradaMensagem {
  retirada: boolean;
  retiradaEm: string | null;
  retiradoPor: string | null;
  retiradoMotivo: string | null;
  /** Retirada automática por denúncia de menor (audit conteudo_retirado_auto sobre esta mensagem). */
  retiradaAuto: boolean;
  podeRepor: boolean;
  impedimento: string | null;
  codigoImpedimento: ImpedimentoRepor | null;
}

/** Estado da retirada da mensagem denunciada e se pode ser reposta (só leitura). `rep`: a denúncia a partir da qual se repõe. */
export async function estadoRetiradaMensagem(q: Q, rep: { id: number; targetId: number; status: string }): Promise<RetiradaMensagem> {
  const [m] = await q.select({ retiradoEm: messagesTable.retiradoEm, retiradoMotivo: messagesTable.retiradoMotivo, retiradoPor: messagesTable.retiradoPor, username: usersTable.username })
    .from(messagesTable).leftJoin(usersTable, eq(usersTable.id, messagesTable.retiradoPor)).where(eq(messagesTable.id, rep.targetId)).limit(1);
  const auto = (await q.select({ id: auditLogTable.id }).from(auditLogTable)
    .where(and(eq(auditLogTable.action, "conteudo_retirado_auto"), eq(auditLogTable.targetType, "mensagem"), eq(auditLogTable.targetId, rep.targetId))).limit(1)).length > 0;
  const base = {
    retirada: !!m?.retiradoEm, retiradaEm: m?.retiradoEm ? m.retiradoEm.toISOString() : null,
    retiradoPor: m?.username ? `@${m.username}` : null, retiradoMotivo: m?.retiradoMotivo ?? null, retiradaAuto: !!m?.retiradoEm && auto && !m.retiradoPor,
  };
  const impedido = (c: ImpedimentoRepor): RetiradaMensagem => ({ ...base, podeRepor: false, impedimento: TEXTO_IMPEDIMENTO[c], codigoImpedimento: c });

  if (!m?.retiradoEm) return impedido("nao_retirada");
  if (rep.status === "pendente" || rep.status === "em_analise") return impedido("por_decidir");
  // Denúncia de menor julgada procedente (esta ou outra): a mensagem nunca se repõe, sem exceção
  if (await temMenorProcedente(q, "mensagem", rep.targetId)) return impedido("menor_procedente");
  const doAlvo = q.select({ id: reportsTable.id }).from(reportsTable).where(and(eq(reportsTable.targetType, "mensagem"), eq(reportsTable.targetId, rep.targetId)));
  const casos = await q.select({ id: menorCasesTable.id }).from(menorCasesTable)
    .where(and(inArray(menorCasesTable.estado, ["aberto", "confirmado"]), inArray(menorCasesTable.reportId, doAlvo))).limit(1);
  if (casos.length > 0) return impedido("caso_menor");
  const outras = await q.select({ id: reportsTable.id }).from(reportsTable)
    .where(and(eq(reportsTable.targetType, "mensagem"), eq(reportsTable.targetId, rep.targetId), ne(reportsTable.id, rep.id), inArray(reportsTable.status, ["pendente", "em_analise", "procedente"]))).limit(1);
  if (outras.length > 0) return impedido("outra_denuncia");
  return { ...base, podeRepor: true, impedimento: null, codigoImpedimento: null };
}

/**
 * Repõe a mensagem denunciada (dentro da transação do chamador). Recusa (409, pt-PT) se `estadoRetiradaMensagem` o impedir.
 * Regista `mensagem_reposta` no audit com o estado anterior (quem retirou, quando, porquê) e o motivo da reposição.
 * A denúncia mantém o estado decidido; nunca mexe em saldos, cópias de prova nem no snapshot.
 */
export async function reporMensagem(tx: Tx, p: { reportId: number; mensagemId: number; reportStatus: string; adminId: number; ip: string | null; motivo: string; automatica: boolean }): Promise<RetiradaMensagem> {
  await tx.select({ id: messagesTable.id }).from(messagesTable).where(eq(messagesTable.id, p.mensagemId)).for("update");
  const antes = await estadoRetiradaMensagem(tx, { id: p.reportId, targetId: p.mensagemId, status: p.reportStatus });
  if (!antes.podeRepor) throw new TakedownError(antes.impedimento ?? "Não é possível repor esta mensagem.", 409);
  await restaurarAlvo(tx, "mensagem", p.mensagemId);
  await tx.insert(auditLogTable).values({
    adminId: p.adminId, action: "mensagem_reposta", targetType: "mensagem", targetId: p.mensagemId,
    details: {
      reportId: p.reportId, motivo: p.motivo, automatica: p.automatica,
      anterior: { retiradoEm: antes.retiradaEm, retiradoPor: antes.retiradoPor, retiradoMotivo: antes.retiradoMotivo, retiradaAuto: antes.retiradaAuto },
    },
    ipAddress: p.ip,
  });
  return antes;
}

/** Quantas vezes esta mensagem foi retirada automaticamente por ESTA denúncia (para a reposição automática em improcedente). */
export async function retiradaAutoDestaDenuncia(q: Q, reportId: number, mensagemId: number): Promise<boolean> {
  const r = await q.select({ id: auditLogTable.id }).from(auditLogTable).where(and(
    eq(auditLogTable.action, "conteudo_retirado_auto"), eq(auditLogTable.targetType, "mensagem"), eq(auditLogTable.targetId, mensagemId),
    sql`${auditLogTable.details}->>'reportId' = ${String(reportId)}`)).limit(1);
  return r.length > 0;
}
