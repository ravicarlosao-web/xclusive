import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  db, usersTable, menorCasesTable, reportsTable, auditLogTable, activeSessionsTable, withdrawalRequestsTable,
  subscriptionsTable, subscriptionPlansTable, postsTable, storiesTable, commentsTable, liveStreamsTable,
} from "@workspace/db";
import { suspenderConta } from "./suspensao";
import { banirContaNaTransacao, BanimentoErro } from "./banimento";
import { notificarSistema } from "./takedown";

/**
 * Registo interno e ações do procedimento interno de casos (ver o documento interno; nada dele está neste repositório).
 *
 *   abrir caso   → suspensão preventiva: conta suspensa, TODO o conteúdo retirado (escondido; nada se apaga), levantamentos
 *                  pendentes e aprovados passam a retido (sem detalhe e sem notificação), sessões copiadas para o caso ANTES
 *                  de a suspensão as apagar;
 *   confirmar    → banimento (origem 'menor', com o id do caso), subscrições canceladas, conteúdo retirado, denúncias de
 *                  menor abertas da conta em bloco como procedentes, sessões revogadas;
 *   não confirmar→ caso arquivado e conta reativada (levantamentos e conteúdo mantêm-se retidos e retirados);
 *   autoridade   → regista a comunicação (nome, data, referência).
 *
 * Tudo numa transação, com as linhas bloqueadas (FOR UPDATE). NUNCA se escreve em logs, notificações nem respostas públicas:
 * a categoria, o id do caso, a descrição, a autoridade, a referência, quem denunciou, emails, documentos, hashes, IP ou
 * user-agent. As notificações ao dono do conteúdo e aos subscritores são neutras.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class MenorErro extends Error {
  constructor(msg: string, public readonly httpStatus: number, public readonly codigo?: string) { super(msg); this.name = "MenorErro"; }
}

const MOTIVO_RETIRADA = "Retido por procedimento interno.";
export const MSG_SUBSCRICAO_CANCELADA = (username: string) => `A conta @${username} deixou de estar disponível. A tua subscrição foi cancelada.`;

/** Retira (esconde) TODO o conteúdo da conta; as lives ativas ou agendadas terminam. Nada é apagado. Devolve contagens. */
async function reterConteudo(tx: Tx, userId: number, adminId: number) {
  const marca = { retiradoEm: new Date(), retiradoMotivo: MOTIVO_RETIRADA, retiradoPor: adminId };
  const posts = await tx.update(postsTable).set(marca).where(and(eq(postsTable.autorId, userId), isNull(postsTable.retiradoEm))).returning({ id: postsTable.id });
  const stories = await tx.update(storiesTable).set(marca).where(and(eq(storiesTable.autorId, userId), isNull(storiesTable.retiradoEm))).returning({ id: storiesTable.id });
  const comentarios = await tx.update(commentsTable).set(marca).where(and(eq(commentsTable.autorId, userId), isNull(commentsTable.retiradoEm))).returning({ id: commentsTable.id });
  await tx.update(liveStreamsTable).set({ status: "terminado", terminadoEm: new Date() })
    .where(and(eq(liveStreamsTable.criadorId, userId), inArray(liveStreamsTable.status, ["agendado", "ao_vivo"])));
  const lives = await tx.update(liveStreamsTable).set(marca).where(and(eq(liveStreamsTable.criadorId, userId), isNull(liveStreamsTable.retiradoEm))).returning({ id: liveStreamsTable.id });
  return { posts: posts.length, stories: stories.length, comentarios: comentarios.length, lives: lives.length };
}

/** Levantamentos pendentes e aprovados → retido, SEM detalhe e SEM notificação. Os ganhos continuam reservados. */
async function reterLevantamentos(tx: Tx, userId: number, adminId: number, casoId: number): Promise<number> {
  const rows = await tx.select({ id: withdrawalRequestsTable.id, status: withdrawalRequestsTable.status, amount: withdrawalRequestsTable.amount }).from(withdrawalRequestsTable)
    .where(and(eq(withdrawalRequestsTable.creatorId, userId), inArray(withdrawalRequestsTable.status, ["pendente", "aprovado"]))).for("update");
  if (rows.length === 0) return 0;
  const agora = new Date();
  await tx.update(withdrawalRequestsTable).set({
    status: "retido", retidoEm: agora, retidoPor: adminId, retidoMotivo: `Caso #${casoId}`, retidoMotivoVisivel: false,
    processedBy: adminId, processedAt: agora,
  }).where(inArray(withdrawalRequestsTable.id, rows.map((r) => r.id)));
  await tx.insert(auditLogTable).values(rows.map((r) => ({
    adminId, action: "withdrawal_retido", targetType: "withdrawal", targetId: r.id,
    details: { before: { status: r.status }, after: { status: "retido" }, amount: Number(r.amount), reembolso: false, retencao: { motivoVisivel: false, caso: casoId } },
  })));
  return rows.length;
}

function exigirAdminAlvo(u: { role: string }) {
  if (u.role === "admin" || u.role === "superadmin") throw new MenorErro("Não é possível abrir um caso sobre uma conta de administrador.", 403);
}

export async function abrirCaso(o: { userId: number; adminId: number; descricao: string; reportId?: number | null; ip: string | null }): Promise<{ id: number; acoes: Record<string, unknown> }> {
  if (o.userId === o.adminId) throw new MenorErro("Não podes abrir um caso sobre a tua própria conta.", 403);
  return db.transaction(async (tx) => {
    const [u] = await tx.select().from(usersTable).where(eq(usersTable.id, o.userId)).for("update");
    if (!u) throw new MenorErro("Utilizador não encontrado.", 404);
    exigirAdminAlvo(u);
    if (u.banidaEm) throw new MenorErro("Esta conta já está banida.", 409);
    const [ativo] = await tx.select({ id: menorCasesTable.id }).from(menorCasesTable)
      .where(and(eq(menorCasesTable.userId, o.userId), inArray(menorCasesTable.estado, ["aberto", "confirmado"]))).limit(1);
    if (ativo) throw new MenorErro("Já existe um caso ativo para esta conta.", 409);
    if (o.reportId != null) {
      const [r] = await tx.select({ reason: reportsTable.reason, owner: reportsTable.targetOwnerId }).from(reportsTable).where(eq(reportsTable.id, o.reportId)).limit(1);
      if (!r || r.reason !== "menor" || r.owner !== o.userId) throw new MenorErro("A denúncia indicada não corresponde a esta conta.", 400);
    }

    // Cópia dos acessos ANTES de a suspensão apagar as sessões (sem tokens: só IP, user-agent e datas).
    const sessoes = await tx.select({ ip: activeSessionsTable.ip, userAgent: activeSessionsTable.userAgent, criadaEm: activeSessionsTable.criadaEm, expiresAt: activeSessionsTable.expiresAt })
      .from(activeSessionsTable).where(eq(activeSessionsTable.userId, o.userId));
    const acessos = sessoes.map((s) => ({ ip: s.ip, userAgent: s.userAgent, criadaEm: s.criadaEm?.toISOString() ?? null, expiraEm: s.expiresAt?.toISOString() ?? null }));

    const [caso] = await tx.insert(menorCasesTable).values({
      userId: o.userId, reportId: o.reportId ?? null, abertoPor: o.adminId, descricao: o.descricao, acessosPreservados: acessos,
    }).returning({ id: menorCasesTable.id });

    const jaInativaAoAbrir = !u.ativo;
    await suspenderConta(tx, o.userId, { adminId: o.adminId, ip: o.ip, origem: "menor" });
    const conteudo = await reterConteudo(tx, o.userId, o.adminId);
    const levantamentosRetidos = await reterLevantamentos(tx, o.userId, o.adminId, caso.id);
    const acoes = { preventiva: true, jaInativaAoAbrir, sessoesCopiadas: acessos.length, conteudoRetido: conteudo, levantamentosRetidos };
    await tx.update(menorCasesTable).set({ acoes }).where(eq(menorCasesTable.id, caso.id));
    await tx.insert(auditLogTable).values({
      adminId: o.adminId, action: "menor_caso_aberto", targetType: "menor_caso", targetId: caso.id,
      details: { userId: o.userId, reportId: o.reportId ?? null, ...acoes }, ipAddress: o.ip,
    });
    return { id: caso.id, acoes };
  });
}

export async function confirmarCaso(o: { casoId: number; adminId: number; motivo: string; ip: string | null }): Promise<{ acoes: Record<string, unknown>; userId: number }> {
  try {
    return await db.transaction(async (tx) => {
      const [c] = await tx.select().from(menorCasesTable).where(eq(menorCasesTable.id, o.casoId)).for("update");
      if (!c) throw new MenorErro("Caso não encontrado.", 404);
      if (c.estado !== "aberto") throw new MenorErro("Este caso já foi decidido.", 409);

      // Banimento (origem 'menor'); sem BAN_HASH_PEPPER recusa antes de alterar o que quer que seja.
      const ban = await banirContaNaTransacao(tx, { userId: c.userId, adminId: o.adminId, motivo: `Caso #${c.id}: ${o.motivo}`.slice(0, 500), ip: o.ip, origem: "menor", casoId: c.id });
      const conteudo = await reterConteudo(tx, c.userId, o.adminId);
      const levantamentosRetidos = await reterLevantamentos(tx, c.userId, o.adminId, c.id);

      // Subscrições: as da conta como subscritora e as dos seus subscritores (notificação neutra). Sem reembolsos.
      const [u] = await tx.select({ username: usersTable.username }).from(usersTable).where(eq(usersTable.id, c.userId));
      const proprias = await tx.update(subscriptionsTable).set({ estado: "cancelada" })
        .where(and(eq(subscriptionsTable.subscriitorId, c.userId), eq(subscriptionsTable.estado, "ativa"))).returning({ id: subscriptionsTable.id });
      const deSubscritores = await tx.update(subscriptionsTable).set({ estado: "cancelada" })
        .where(and(eq(subscriptionsTable.criadorId, c.userId), eq(subscriptionsTable.estado, "ativa"))).returning({ subscritorId: subscriptionsTable.subscriitorId });
      for (const s of deSubscritores) await notificarSistema(tx, s.subscritorId, MSG_SUBSCRICAO_CANCELADA(u.username));
      await tx.update(subscriptionPlansTable).set({ ativo: false }).where(eq(subscriptionPlansTable.criadorId, c.userId));

      // Denúncias de menor ainda abertas sobre a conta e o seu conteúdo → procedentes, em bloco (bloqueio permanente de eliminação).
      const agora = new Date();
      const denuncias = await tx.update(reportsTable).set({ status: "procedente", resolvedBy: o.adminId, resolvedAt: agora, acaoRetirou: true, acaoSuspendeu: true })
        .where(and(eq(reportsTable.targetOwnerId, c.userId), eq(reportsTable.reason, "menor"), inArray(reportsTable.status, ["pendente", "em_analise"]))).returning({ id: reportsTable.id });
      if (denuncias.length > 0) {
        await tx.insert(auditLogTable).values(denuncias.map((d) => ({
          adminId: o.adminId, action: "report_procedente", targetType: "report", targetId: d.id,
          details: { before: { status: "aberta" }, after: { status: "procedente" }, origem: "caso", casoId: c.id }, ipAddress: o.ip,
        })));
      }

      const acoes = {
        ...(c.acoes as Record<string, unknown>),
        confirmado: {
          bloqueios: { email: ban.hashesEmail, documento: ban.hashesDocumento }, conteudoRetido: conteudo, levantamentosRetidos,
          subscricoesCanceladas: proprias.length, subscritoresNotificados: deSubscritores.length, denunciasProcedentes: denuncias.length,
        },
      };
      await tx.update(menorCasesTable).set({ estado: "confirmado", decisaoEm: agora, decisaoPor: o.adminId, decisaoMotivo: o.motivo, acoes }).where(eq(menorCasesTable.id, c.id));
      await tx.insert(auditLogTable).values({
        adminId: o.adminId, action: "menor_confirmado", targetType: "menor_caso", targetId: c.id,
        details: { userId: c.userId, ...(acoes.confirmado as object) }, ipAddress: o.ip,
      });
      return { acoes, userId: c.userId };
    });
  } catch (err) {
    if (err instanceof BanimentoErro) throw new MenorErro(err.message, err.httpStatus, err.codigo);
    throw err;
  }
}

export async function naoConfirmarCaso(o: { casoId: number; adminId: number; motivo: string; ip: string | null }): Promise<{ reativada: boolean }> {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(menorCasesTable).where(eq(menorCasesTable.id, o.casoId)).for("update");
    if (!c) throw new MenorErro("Caso não encontrado.", 404);
    if (c.estado !== "aberto") throw new MenorErro("Este caso já foi decidido.", 409);
    const [u] = await tx.select().from(usersTable).where(eq(usersTable.id, c.userId)).for("update");
    // Só reativa se a conta estava ativa antes do caso e continua apenas suspensa (nunca uma encerrada ou banida).
    const jaInativa = (c.acoes as { jaInativaAoAbrir?: boolean }).jaInativaAoAbrir === true;
    const reativar = !!u && !u.ativo && !u.encerradaEm && !u.banidaEm && !jaInativa;
    if (reativar) await tx.update(usersTable).set({ ativo: true }).where(eq(usersTable.id, c.userId));
    const agora = new Date();
    const acoes = { ...(c.acoes as Record<string, unknown>), arquivado: { contaReativada: reativar } };
    await tx.update(menorCasesTable).set({ estado: "arquivado", decisaoEm: agora, decisaoPor: o.adminId, decisaoMotivo: o.motivo, acoes }).where(eq(menorCasesTable.id, c.id));
    await tx.insert(auditLogTable).values({
      adminId: o.adminId, action: "menor_caso_arquivado", targetType: "menor_caso", targetId: c.id,
      details: { userId: c.userId, contaReativada: reativar }, ipAddress: o.ip,
    });
    return { reativada: reativar };
  });
}

export async function registarAutoridade(o: { casoId: number; adminId: number; autoridade: string; comunicadaEm: Date; referencia: string | null; ip: string | null }): Promise<void> {
  await db.transaction(async (tx) => {
    const [c] = await tx.select().from(menorCasesTable).where(eq(menorCasesTable.id, o.casoId)).for("update");
    if (!c) throw new MenorErro("Caso não encontrado.", 404);
    await tx.update(menorCasesTable).set({
      autoridade: o.autoridade, autoridadeComunicadaEm: o.comunicadaEm, autoridadeReferencia: o.referencia, autoridadeRegistadaPor: o.adminId,
    }).where(eq(menorCasesTable.id, c.id));
    await tx.insert(auditLogTable).values({
      adminId: o.adminId, action: "menor_autoridade_registada", targetType: "menor_caso", targetId: c.id,
      details: { atualizacao: c.autoridade !== null }, ipAddress: o.ip,
    });
  });
}

/** Caso ativo (aberto ou confirmado) da conta, para o aviso no perfil. */
export async function casoAtivoDaConta(q: typeof db | Tx, userId: number): Promise<{ id: number; estado: string } | null> {
  const [c] = await q.select({ id: menorCasesTable.id, estado: menorCasesTable.estado }).from(menorCasesTable)
    .where(and(eq(menorCasesTable.userId, userId), inArray(menorCasesTable.estado, ["aberto", "confirmado"]))).limit(1);
  return c ?? null;
}

