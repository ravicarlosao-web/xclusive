import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db, usersTable, withdrawalRequestsTable, topupRequestsTable, liveStreamsTable, reportsTable, subscriptionsTable,
  subscriptionPlansTable, accountClosuresTable, auditLogTable,
} from "@workspace/db";
import { suspenderConta } from "./suspensao";
import { notificarSistema } from "./takedown";

/**
 * Encerramento de conta pelo próprio utilizador.
 *
 * Encerrar = a conta fica inacessível e invisível já (ativo=false + encerrada_em, sessões e tokens revogados); NADA do que a
 * lei, a fraude, os menores e a prova exigem se apaga aqui (transações, KYC, aceites, denúncias, auditoria, conteúdo
 * protegido). O resto entra na fila `account_closures`: a purga real é do PR de retenção, depois da janela de arrependimento.
 * Tudo numa transação, com a linha do utilizador bloqueada (FOR UPDATE). Nunca se registam em logs IP, User-Agent,
 * password, saldos nem emails.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Q = Tx | typeof db;

/** Janela de arrependimento: a conta pode ser reaberta pelo admin até `encerrada_em` + 30 dias. */
export const JANELA_DIAS = 30;
const DIA_MS = 24 * 60 * 60 * 1000;
export const apagarApos = (encerradaEm: Date): Date => new Date(encerradaEm.getTime() + JANELA_DIAS * DIA_MS);

export const emailLegal = (): string => process.env.LEGAL_EMAIL?.trim() || "legal@xclusive.ao";

export const MSG_ENCERRADA_JANELA = () => `A tua conta foi encerrada a teu pedido. Se mudaste de ideias, contacta ${emailLegal()} nos primeiros ${JANELA_DIAS} dias.`;
export const MSG_ENCERRADA_DEFINITIVA = "Esta conta foi encerrada e já não pode ser reaberta.";
export const MSG_ENCERRADA_SESSAO = "A tua conta foi encerrada.";
export const CODIGO_CONTA_ENCERRADA = "conta_encerrada";

/** Mensagem do login/refresh de uma conta encerrada: depende de a janela de 30 dias ainda estar aberta. */
export async function mensagemContaEncerrada(q: Q, userId: number, agora: Date = new Date()): Promise<string> {
  const [c] = await q.select({ apagarApos: accountClosuresTable.apagarApos, estado: accountClosuresTable.estado }).from(accountClosuresTable)
    .where(and(eq(accountClosuresTable.userId, userId), eq(accountClosuresTable.estado, "pendente"))).limit(1);
  return c && c.apagarApos.getTime() > agora.getTime() ? MSG_ENCERRADA_JANELA() : MSG_ENCERRADA_DEFINITIVA;
}

export type Bloqueio = { codigo: "saldo" | "ganhos" | "levantamento" | "live" | "carregamento" | "indisponivel"; mensagem: string };

const kz = (v: unknown) => `${Number(v).toLocaleString("pt-PT")} Kz`;
const ABERTA = ["pendente", "em_analise"] as const;

/**
 * Bloqueios do encerramento. Os resolúveis são explicados à pessoa. A denúncia de menor aberta (sobre a conta ou o seu
 * conteúdo) NÃO é revelada: aparece só como "indisponivel", com mensagem neutra.
 */
export async function bloqueiosDeEncerramento(q: Q, u: { id: number; saldo: string; ganhos: string }): Promise<Bloqueio[]> {
  const out: Bloqueio[] = [];
  if (Number(u.saldo) > 0) out.push({ codigo: "saldo", mensagem: `Tens ${kz(u.saldo)} de saldo. Gasta-o ou pede o reembolso a ${emailLegal()} antes de encerrares.` });
  if (Number(u.ganhos) > 0) out.push({ codigo: "ganhos", mensagem: `Tens ${kz(u.ganhos)} em ganhos por levantar. Levanta-os (ou contacta ${emailLegal()}) antes de encerrares.` });

  const [lev] = await q.select({ id: withdrawalRequestsTable.id }).from(withdrawalRequestsTable)
    .where(and(eq(withdrawalRequestsTable.creatorId, u.id), inArray(withdrawalRequestsTable.status, ["pendente", "aprovado", "retido"]))).limit(1);
  if (lev) out.push({ codigo: "levantamento", mensagem: "Tens um levantamento por concluir. Aguarda que fique pago ou rejeitado antes de encerrares." });

  const [live] = await q.select({ id: liveStreamsTable.id }).from(liveStreamsTable)
    .where(and(eq(liveStreamsTable.criadorId, u.id), inArray(liveStreamsTable.status, ["agendado", "ao_vivo"]))).limit(1);
  if (live) out.push({ codigo: "live", mensagem: "Termina ou cancela a tua live antes de encerrares." });

  const [topup] = await q.select({ id: topupRequestsTable.id }).from(topupRequestsTable)
    .where(and(eq(topupRequestsTable.userId, u.id), inArray(topupRequestsTable.status, ["pendente", "processando", "aguardando_pagamento"]))).limit(1);
  if (topup) out.push({ codigo: "carregamento", mensagem: "Tens um carregamento em curso. Aguarda que seja concluído antes de encerrares." });

  // Denúncia de menor aberta sobre a conta ou o seu conteúdo (target_owner_id cobre os dois): mensagem neutra.
  const [menor] = await q.select({ id: reportsTable.id }).from(reportsTable)
    .where(and(eq(reportsTable.targetOwnerId, u.id), eq(reportsTable.reason, "menor"), inArray(reportsTable.status, [...ABERTA]))).limit(1);
  if (menor) out.push({ codigo: "indisponivel", mensagem: `De momento não é possível encerrar a conta. Contacta ${emailLegal()}.` });
  return out;
}

export class EncerramentoErro extends Error {
  constructor(msg: string, public readonly httpStatus: number, public readonly bloqueios?: Bloqueio[]) { super(msg); this.name = "EncerramentoErro"; }
}

/** Encerra a conta do utilizador (a password já foi verificada pela rota). Tudo numa transação. */
export async function encerrarConta(o: { userId: number; ip: string | null; userAgent: string | null }): Promise<{ apagarApos: Date }> {
  return db.transaction(async (tx) => {
    const [u] = await tx.select().from(usersTable).where(eq(usersTable.id, o.userId)).for("update");
    if (!u) throw new EncerramentoErro("Utilizador não encontrado.", 404);
    if (u.role === "admin" || u.role === "superadmin") throw new EncerramentoErro("As contas de administrador não se encerram por aqui.", 403);
    if (!u.ativo || u.encerradaEm) throw new EncerramentoErro("A conta já não está ativa.", 409);

    const bloqueios = await bloqueiosDeEncerramento(tx, u);
    if (bloqueios.length > 0) throw new EncerramentoErro(bloqueios[0].mensagem, 409, bloqueios);

    // Suspensão partilhada (ativo=false, sessões e refresh tokens revogados) e só depois a marca de encerrada (CHECK da BD).
    await suspenderConta(tx, o.userId, { adminId: o.userId, ip: o.ip, origem: "encerramento" });
    const agora = new Date();
    await tx.update(usersTable).set({ encerradaEm: agora }).where(eq(usersTable.id, o.userId));

    // Subscrições: as do subscritor que encerra e, se for criadora, as dos seus subscritores (com notificação do sistema).
    const minhas = await tx.update(subscriptionsTable).set({ estado: "cancelada" })
      .where(and(eq(subscriptionsTable.subscriitorId, o.userId), eq(subscriptionsTable.estado, "ativa")))
      .returning({ id: subscriptionsTable.id });
    const dosSubscritores = await tx.update(subscriptionsTable).set({ estado: "cancelada" })
      .where(and(eq(subscriptionsTable.criadorId, o.userId), eq(subscriptionsTable.estado, "ativa")))
      .returning({ subscritorId: subscriptionsTable.subscriitorId });
    for (const s of dosSubscritores) {
      await notificarSistema(tx, s.subscritorId, `@${u.username} encerrou a conta e a tua subscrição foi cancelada.`);
    }
    await tx.update(subscriptionPlansTable).set({ ativo: false }).where(eq(subscriptionPlansTable.criadorId, o.userId));

    const limite = apagarApos(agora);
    await tx.insert(accountClosuresTable).values({
      userId: o.userId, encerradaEm: agora, origem: "utilizador", tipoConta: u.tipoConta, ip: o.ip, userAgent: o.userAgent, apagarApos: limite,
    });
    await tx.insert(auditLogTable).values({
      adminId: o.userId, action: "conta_encerrada", targetType: "user", targetId: o.userId,
      details: { tipoConta: u.tipoConta, subscricoesCanceladas: minhas.length, subscritoresNotificados: dosSubscritores.length, apagarApos: limite.toISOString() },
      ipAddress: o.ip,
    });
    return { apagarApos: limite };
  });
}

/** Reabre uma conta encerrada dentro da janela (só o admin). Não repõe sessões, subscrições nem lives. */
export async function reabrirConta(o: { userId: number; adminId: number; motivo: string; ip: string | null }): Promise<void> {
  await db.transaction(async (tx) => {
    const [u] = await tx.select().from(usersTable).where(eq(usersTable.id, o.userId)).for("update");
    if (!u) throw new EncerramentoErro("Utilizador não encontrado.", 404);
    if (u.banidaEm) throw new EncerramentoErro("Esta conta está banida de forma permanente: não se reabre.", 409);
    if (!u.encerradaEm) throw new EncerramentoErro("Esta conta não está encerrada.", 409);
    const [c] = await tx.select().from(accountClosuresTable)
      .where(and(eq(accountClosuresTable.userId, o.userId), eq(accountClosuresTable.estado, "pendente"))).for("update").limit(1);
    if (!c) throw new EncerramentoErro("Esta conta já não pode ser reaberta (a fila de encerramento já foi tratada).", 409);
    if (c.apagarApos.getTime() <= Date.now()) throw new EncerramentoErro(`A janela de ${JANELA_DIAS} dias terminou: a conta já não pode ser reaberta.`, 409);

    await tx.update(usersTable).set({ ativo: true, encerradaEm: null }).where(eq(usersTable.id, o.userId));
    await tx.update(accountClosuresTable).set({ estado: "reaberta", reabertaEm: new Date(), reabertaPor: o.adminId, reabertaMotivo: o.motivo })
      .where(eq(accountClosuresTable.id, c.id));
    await tx.insert(auditLogTable).values({
      adminId: o.adminId, action: "conta_reaberta", targetType: "user", targetId: o.userId,
      details: { motivo: o.motivo }, ipAddress: o.ip,
    });
  });
}

/** SQL: o utilizador (coluna indicada) está ativo. Para filtrar listas (seguidores, sugestões, comentários, conversas). */
export const utilizadorAtivo = (col: unknown) => sql`${col} IN (SELECT id FROM users WHERE ativo)`;
