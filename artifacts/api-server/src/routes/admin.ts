/**
 * Admin API routes — /api/admin/*
 *
 * Todas as rotas lêem/escrevem na base de dados real via Drizzle ORM.
 *
 * Segurança:
 *   - Todas as rotas (exceto /admin/auth/login) exigem requireAdmin (role: admin | superadmin).
 *   - Rate limiting aplicado ao nível do router (100 req/min por IP, 5/15min no login).
 *   - Todas as acções destrutivas escrevem no audit_log.
 */

import { Router } from "express";
import { requireAdmin, type AdminRequest } from "../middlewares/requireAdmin.js";
import { signToken } from "../lib/auth.js";
import { signMediaUrl, verifyMediaUrl } from "../lib/media.js";
import {
  db,
  auditLogTable,
  usersTable,
  postsTable,
  postMediaTable,
  reportsTable,
  withdrawalRequestsTable,
  platformSettingsTable,
  subscriptionPlansTable,
  purchasesTable,
  followsTable,
  subscriptionsTable,
  kycSubmissionsTable,
  creatorTermsAcceptancesTable,
  accountClosuresTable,
  topupRequestsTable,
  notificationsTable,
  infracoesMais18Table,
} from "@workspace/db";
import {
  eq,
  and,
  desc,
  asc,
  or,
  ilike,
  sql,
  gte,
  count,
  sum,
  isNotNull,
  isNull,
  inArray,
  notInArray,
} from "drizzle-orm";
import bcrypt from "bcryptjs";
import { getPrivateSignedUrl, getPublicUrl, isPrivateStorageKey, isPaidKey, isPrivateStorageConfigured, resolveMediaUrl, urlMedia, urlParaServidor, PROVA_URL_TTL_SECONDS } from "../lib/storage.js";
import { estadoRetiradaMensagem, excertoParaAdmin, reporMensagem, retiradaAutoDestaDenuncia } from "../lib/denunciaMensagem.js";
import {
  TARGET_TYPES, TARGET_LABEL, alvoSuportado, rotuloAlvo, lerAlvo, retirarAlvo, restaurarAlvo, notificarSistema, TakedownError, type TargetType,
} from "../lib/takedown.js";
import { eliminarPost, responderErroEliminacao } from "../lib/provaProtegida.js";
import { reabrirConta, EncerramentoErro } from "../lib/encerramento.js";
import { banirConta, BanimentoErro } from "../lib/banimento.js";
import { emailLegal } from "../lib/encerramento.js";
import { casoAtivoDaConta } from "../lib/menores.js";
import { erroSeguro } from "../lib/erroSeguro.js";
import { suspenderConta, desligarSockets } from "../lib/suspensao.js";
import { marcarMais18PorAdmin, anularInfracao, contarInfracoesAtivas, efeitosAposCommit, isTipoMais18 } from "../lib/infracoesMais18.js";
import { REGISTOS_KEY, registosAbertosDe } from "../lib/registos.js";
import { COMMISSION_KEY, lerTaxaGlobal, taxaValida, taxaComDuasCasas } from "../lib/commission.js";

// ── Audit log helper ─────────────────────────────────────────────────────────

async function logAudit(
  req: AdminRequest,
  action: string,
  targetType: string | null,
  targetId: number | null,
  details: Record<string, unknown>
): Promise<void> {
  try {
    await db.insert(auditLogTable).values({
      adminId: req.adminId!,
      action,
      targetType: targetType ?? undefined,
      targetId: targetId ?? undefined,
      details,
      ipAddress: req.ip ?? null,
    });
  } catch (err) {
    (req as any).log?.error({ err }, `logAudit falhou: ${action}`);
  }
}

// ── Paginação helper ──────────────────────────────────────────────────────────

function paginate<T>(items: T[], total: number, page: number, limit: number) {
  return {
    data: items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    hasMore: (page - 1) * limit + items.length < total,
  };
}

// ── Mapeamento ativo boolean → estado string ──────────────────────────────────

function mapEstado(ativo: boolean, encerradaEm?: Date | null, banidaEm?: Date | null): string {
  if (banidaEm) return "banida";
  if (encerradaEm) return "encerrada";
  return ativo ? "ativo" : "suspenso";
}

function mapUser(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    nomeExibicao: u.nomeExibicao,
    bio: u.bio ?? null,
    avatarUrl: urlMedia(u.avatarUrl ?? null),
    capaUrl: urlMedia(u.capaUrl ?? null),
    tipoConta: u.tipoConta,
    verificado: u.verificado,
    privado: u.privado,
    role: u.role,
    estado: mapEstado(u.ativo, u.encerradaEm, u.banidaEm),
    saldo: Number(u.saldo),
    ganhos: Number(u.ganhos),
    comissaoPersonalizada: u.comissaoPersonalizada !== null && u.comissaoPersonalizada !== undefined
      ? Number(u.comissaoPersonalizada)
      : null,
    criadoEm: u.criadoEm,
  };
}

const router = Router();

// ── Rate limiting ─────────────────────────────────────────────────────────────

const requestCounts = new Map<string, { count: number; resetAt: number }>();
function rateLimit(req: AdminRequest, res: any, next: any) {
  const ip = req.ip ?? "unknown";
  const now = Date.now();
  const entry = requestCounts.get(ip);
  if (!entry || entry.resetAt < now) {
    requestCounts.set(ip, { count: 1, resetAt: now + 60_000 });
    return next();
  }
  entry.count++;
  if (entry.count > 100) {
    return void res.status(429).json({ error: "Demasiadas requisições. Tente novamente em 1 minuto." });
  }
  next();
}

const loginCounts = new Map<string, { count: number; resetAt: number }>();
function loginLimiter(req: AdminRequest, res: any, next: any) {
  const ip = req.ip ?? "unknown";
  const now = Date.now();
  const entry = loginCounts.get(ip);
  if (!entry || entry.resetAt < now) {
    loginCounts.set(ip, { count: 1, resetAt: now + 15 * 60_000 });
    return next();
  }
  entry.count++;
  if (entry.count > 5) {
    return void res.status(429).json({ error: "Demasiadas tentativas de login. Tente novamente em 15 minutos." });
  }
  next();
}

// ── Signed media proxy ───────────────────────────────────────────────────────

router.get("/admin/media", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const { url, exp, sig } = req.query as Record<string, string>;
  const rawUrl = verifyMediaUrl(url, exp, sig);
  if (!rawUrl) {
    return void res.status(403).json({ error: "URL de media inválido ou expirado." });
  }
  try {
    // O CDN público exige token: assina o URL (se for nosso) antes de ir buscar o ficheiro.
    const upstream = await fetch(urlParaServidor(rawUrl));
    if (!upstream.ok) return void res.status(502).json({ error: "Não foi possível obter o recurso." });
    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
    const contentLength = upstream.headers.get("content-length");
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "no-store");
    if (contentLength) res.setHeader("Content-Length", contentLength);
    const reader = upstream.body?.getReader();
    if (!reader) return void res.status(502).end();
    const pump = async (): Promise<void> => {
      const { done, value } = await reader.read();
      if (done) { res.end(); return; }
      res.write(value);
      return pump();
    };
    await pump();
  } catch {
    if (!res.headersSent) res.status(502).json({ error: "Erro ao obter o recurso." });
  }
});

// ── Login ────────────────────────────────────────────────────────────────────

router.post("/admin/auth/login", loginLimiter, async (req, res): Promise<void> => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    res.status(400).json({ error: "Email e password são obrigatórios" });
    return;
  }
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (!user || (user.role !== "admin" && user.role !== "superadmin")) {
    res.status(401).json({ error: "Credenciais inválidas" });
    return;
  }
  const passwordOk = await bcrypt.compare(password, user.passwordHash);
  if (!passwordOk) {
    res.status(401).json({ error: "Credenciais inválidas" });
    return;
  }
  const token = signToken({ userId: user.id, username: user.username, role: user.role });
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      nomeExibicao: user.nomeExibicao ?? user.username,
      email: user.email,
      role: user.role,
      avatarUrl: urlMedia(user.avatarUrl ?? null),
    },
    expiresIn: 14400,
  });
});

router.use("/admin", rateLimit, requireAdmin);

// ────────────────────────────────────────────────────────────────────────────
// DASHBOARD
// ────────────────────────────────────────────────────────────────────────────

router.get("/admin/dashboard/kpis", async (req, res) => {
  try {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const [
      [{ totalUtilizadores }],
      [{ totalCriadores }],
      [{ novosHoje }],
      [{ postsHoje }],
      [{ denunciasPendentes }],
      [{ denunciasUrgentes, urgenteMaisAntigaEm }],
      [{ levantamentosPendentes }],
      [{ receitaTotal }],
      [{ comissaoMes }],
    ] = await Promise.all([
      db.select({ totalUtilizadores: count() }).from(usersTable)
        .where(notInArray(usersTable.role, ['admin', 'superadmin'])),
      db.select({ totalCriadores: count() }).from(usersTable)
        .where(and(eq(usersTable.tipoConta, "criador"), notInArray(usersTable.role, ['admin', 'superadmin']))),
      db.select({ novosHoje: count() }).from(usersTable)
        .where(and(gte(usersTable.criadoEm, hoje), notInArray(usersTable.role, ['admin', 'superadmin']))),
      db.select({ postsHoje: count() }).from(postsTable)
        .where(gte(postsTable.criadoEm, hoje)),
      db.select({ denunciasPendentes: count() }).from(reportsTable)
        .where(eq(reportsTable.status, "pendente")),
      db.select({ denunciasUrgentes: count(), urgenteMaisAntigaEm: sql<Date | null>`min(${reportsTable.criadoEm})` }).from(reportsTable)
        .where(and(eq(reportsTable.status, "pendente"), eq(reportsTable.urgente, true))),
      db.select({ levantamentosPendentes: count() }).from(withdrawalRequestsTable)
        .where(eq(withdrawalRequestsTable.status, "pendente")),
      db.select({ receitaTotal: sum(purchasesTable.valor) }).from(purchasesTable),
      db.select({ comissaoMes: sum(purchasesTable.comissao) }).from(purchasesTable)
        .where(gte(purchasesTable.criadoEm, new Date(hoje.getFullYear(), hoje.getMonth(), 1))),
    ]);

    const receitaTotalNum = Number(receitaTotal ?? 0);
    const comissaoMesNum = Number(comissaoMes ?? 0);

    res.json({
      totalUtilizadores: Number(totalUtilizadores),
      totalCriadores: Number(totalCriadores),
      novosHoje: Number(novosHoje),
      receitaTotal: receitaTotalNum,
      comissaoMes: comissaoMesNum,
      postsHoje: Number(postsHoje),
      denunciasPendentes: Number(denunciasPendentes),
      denunciasUrgentes: Number(denunciasUrgentes),
      // Idade (minutos) da urgente mais antiga por tratar; null se não houver.
      urgenteMaisAntigaMin: urgenteMaisAntigaEm
        ? Math.max(0, Math.floor((Date.now() - new Date(urgenteMaisAntigaEm).getTime()) / 60_000))
        : null,
      levantamentosPendentes: Number(levantamentosPendentes),
    });
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao obter KPIs");
    res.status(500).json({ error: "Erro interno." });
  }
});

router.get("/admin/dashboard/charts", async (req, res) => {
  try {
    // Últimos 30 dias — novos utilizadores por dia
    const dias30 = await db.execute(sql`
      SELECT
        DATE(criado_em)::text AS data,
        COUNT(*)::int AS "novosUtilizadores"
      FROM users
      WHERE criado_em >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(criado_em)
      ORDER BY data ASC
    `);

    // Receita por dia (purchases)
    const receitaDias = await db.execute(sql`
      SELECT
        DATE(criado_em)::text AS data,
        COALESCE(SUM(CASE WHEN tipo = 'gorjeta' THEN valor ELSE 0 END), 0)::numeric AS gorjetas,
        COALESCE(SUM(CASE WHEN tipo = 'subscricao' THEN valor ELSE 0 END), 0)::numeric AS subscricoes,
        COALESCE(SUM(CASE WHEN tipo = 'ppv' THEN valor ELSE 0 END), 0)::numeric AS ppv
      FROM purchases
      WHERE criado_em >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(criado_em)
      ORDER BY data ASC
    `);

    // Mapa de receita por data
    const receitaMap = new Map<string, any>();
    for (const r of (receitaDias as any).rows ?? []) {
      receitaMap.set(r.data, r);
    }

    // Juntar os dois arrays por data, preenchendo zeros onde não há dados
    const dias30Rows = (dias30 as any).rows ?? [];
    const chartDias = dias30Rows.map((d: any) => ({
      data: d.data,
      novosUtilizadores: d.novosUtilizadores,
      gorjetas: Number(receitaMap.get(d.data)?.gorjetas ?? 0),
      subscricoes: Number(receitaMap.get(d.data)?.subscricoes ?? 0),
      ppv: Number(receitaMap.get(d.data)?.ppv ?? 0),
    }));

    // Top 10 criadores por ganhos
    const top10 = await db
      .select({
        id: usersTable.id,
        username: usersTable.username,
        nomeExibicao: usersTable.nomeExibicao,
        ganhos: usersTable.ganhos,
        avatarUrl: usersTable.avatarUrl,
      })
      .from(usersTable)
      .where(eq(usersTable.tipoConta, "criador"))
      .orderBy(desc(usersTable.ganhos))
      .limit(10);

    res.json({
      dias30: chartDias,
      top10Criadores: top10.map(u => ({ ...u, avatarUrl: urlMedia(u.avatarUrl), ganhos: Number(u.ganhos) })),
      distribuicaoPaises: [], // campo não existe na DB actual
    });
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao obter charts");
    res.status(500).json({ error: "Erro interno." });
  }
});

router.get("/admin/dashboard/activity-feed", async (req, res) => {
  try {
    // Últimas entradas do audit_log com info do admin
    const logs = await db
      .select({
        id: auditLogTable.id,
        action: auditLogTable.action,
        targetType: auditLogTable.targetType,
        targetId: auditLogTable.targetId,
        details: auditLogTable.details,
        criadoEm: auditLogTable.criadoEm,
        adminUsername: usersTable.username,
      })
      .from(auditLogTable)
      .leftJoin(usersTable, eq(auditLogTable.adminId, usersTable.id))
      .orderBy(desc(auditLogTable.criadoEm))
      .limit(20);

    // Novos utilizadores recentes (últimas 24h)
    const novosUsers = await db
      .select({ id: usersTable.id, username: usersTable.username, criadoEm: usersTable.criadoEm })
      .from(usersTable)
      .where(gte(usersTable.criadoEm, new Date(Date.now() - 24 * 60 * 60 * 1000)))
      .orderBy(desc(usersTable.criadoEm))
      .limit(5);

    const feedFromAudit = logs.map(l => ({
      id: l.id,
      tipo: l.action,
      mensagem: formatAuditMessage(l.action, l.adminUsername ?? "admin", l.targetType, l.targetId, l.details as any),
      criadoEm: l.criadoEm,
    }));

    const feedFromUsers = novosUsers.map(u => ({
      id: `user-${u.id}`,
      tipo: "novo_registo",
      mensagem: `${u.username} registou-se na plataforma`,
      criadoEm: u.criadoEm,
    }));

    const feed = [...feedFromAudit, ...feedFromUsers]
      .sort((a, b) => new Date(b.criadoEm).getTime() - new Date(a.criadoEm).getTime())
      .slice(0, 15);

    res.json(feed);
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao obter activity feed");
    res.status(500).json({ error: "Erro interno." });
  }
});

function formatAuditMessage(action: string, admin: string, targetType: string | null, targetId: number | null, details: any): string {
  const target = targetId ? ` #${targetId}` : "";
  switch (action) {
    case "registos_update": return `${admin} ${details?.novo ? "abriu" : "fechou"} os registos de novas contas`;
    case "user_suspend": return `${admin} suspendeu utilizador${target}`;
    case "user_reactivate": return `${admin} reactivou utilizador${target}`;
    case "user_delete": return `${admin} eliminou utilizador${target}`;
    case "user_role_change": return `${admin} alterou role do utilizador${target}`;
    case "user_edit": return `${admin} editou utilizador${target}`;
    case "kyc_aprovar": return `${admin} aprovou KYC do criador${target}`;
    case "kyc_rejeitar": return `${admin} rejeitou KYC do criador${target}`;
    case "post_delete": return `${admin} eliminou post${target}`;
    case "report_resolve": return `${admin} resolveu denúncia${target}`;
    case "withdrawal_aprovado": return `${admin} aprovou levantamento${target}`;
    case "withdrawal_rejeitado": return `${admin} rejeitou levantamento${target}`;
    case "withdrawal_pago": return `${admin} marcou levantamento${target} como pago`;
    case "withdrawal_retido": return `${admin} reteve o levantamento${target}`;
    case "withdrawal_dados_vistos": return `${admin} consultou os dados de pagamento do levantamento${target}`;
    case "withdrawal_approved": return `${admin} aprovou levantamento${target}`;
    case "withdrawal_rejected": return `${admin} rejeitou levantamento${target}`;
    case "withdrawal_paid": return `${admin} marcou levantamento${target} como pago`;
    case "report_em_analise": return `${admin} pôs a denúncia${target} em análise`;
    case "report_procedente": return `${admin} deu como procedente a denúncia${target}`;
    case "report_improcedente": return `${admin} deu como improcedente a denúncia${target}`;
    case "report_conteudo_visto": return `${admin} consultou o conteúdo denunciado${target}`;
    case "conteudo_retirado": return `${admin} retirou conteúdo${target}`;
    case "menor_caso_aberto": return `${admin} abriu um caso${target}`;
    case "menor_confirmado": return `${admin} confirmou um caso${target}`;
    case "menor_caso_arquivado": return `${admin} arquivou um caso${target}`;
    case "menor_autoridade_registada": return `${admin} registou uma comunicação no caso${target}`;
    case "menor_caso_visto": return `${admin} consultou um caso${target}`;
    case "conteudo_retirado_auto": return `Retirada automática (denúncia de menor)${target}`;
    case "conteudo_restaurado": return `${admin} repôs conteúdo${target}`;
    case "mensagem_reposta": return `${admin} repôs uma mensagem${target}`;
    case "conteudo_ficheiros_apagar_pedido": return `${admin} pediu a eliminação dos ficheiros do conteúdo${target}`;
    case "conteudo_ficheiros_apagados": return `${admin} eliminou os ficheiros do conteúdo${target}`;
    case "eliminacao_recusada": return `Tentativa de eliminar conteúdo protegido recusada${target}`;
    case "conteudo_eliminado_autor": return `O autor eliminou conteúdo${target}`;
    case "settings_update": return `${admin} actualizou definições da plataforma`;
    case "broadcast_send": return `${admin} enviou comunicado: ${details?.titulo ?? ""}`;
    case "balance_adjustment": return `${admin} ajustou saldo do criador${target}`;
    default: return `${admin} executou ${action}${target}`;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// USERS
// ────────────────────────────────────────────────────────────────────────────

router.get("/admin/users", async (req, res) => {
  try {
    const { page = "1", limit = "10", role, estado, search } = req.query as Record<string, string>;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions: any[] = [];
    if (role) {
      conditions.push(eq(usersTable.role, role));
    } else {
      conditions.push(notInArray(usersTable.role, ['admin', 'superadmin']));
    }
    if (estado === "suspenso") conditions.push(and(eq(usersTable.ativo, false), isNull(usersTable.encerradaEm), isNull(usersTable.banidaEm)));
    if (estado === "encerrada") conditions.push(and(isNotNull(usersTable.encerradaEm), isNull(usersTable.banidaEm)));
    if (estado === "banida") conditions.push(isNotNull(usersTable.banidaEm));
    if (estado === "ativo") conditions.push(eq(usersTable.ativo, true));
    if (search) {
      conditions.push(or(
        ilike(usersTable.username, `%${search}%`),
        ilike(usersTable.email, `%${search}%`),
        ilike(usersTable.nomeExibicao, `%${search}%`),
      ));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      db.select().from(usersTable)
        .where(where)
        .orderBy(desc(usersTable.criadoEm))
        .limit(limitNum)
        .offset(offset),
      db.select({ total: count() }).from(usersTable).where(where),
    ]);

    res.json(paginate(rows.map(mapUser), Number(total), pageNum, limitNum));
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao listar utilizadores");
    res.status(500).json({ error: "Erro interno." });
  }
});

// Commission routes MUST be registered BEFORE /admin/users/:id, otherwise
// Express matches "commission-overview" as the :id dynamic segment.

/**
 * PATCH /api/admin/users/:id/commission
 * Define ou remove a taxa de comissão personalizada de um criador.
 *
 * Body: { comissaoPersonalizada: number | null }
 *   - number (0-100): define o override para este criador
 *   - null: remove o override (volta à taxa global)
 */
router.patch("/admin/users/:id/commission", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  try {
    const userId = parseInt(String(req.params.id), 10);
    if (isNaN(userId)) { res.status(400).json({ error: "ID inválido." }); return; }

    const { comissaoPersonalizada } = req.body as { comissaoPersonalizada: number | null };

    // Validar: null (remover override) ou NÚMERO entre 0 e 100 (máx. 2 casas decimais)
    if (comissaoPersonalizada !== null) {
      if (!taxaValida(comissaoPersonalizada) || !taxaComDuasCasas(comissaoPersonalizada)) {
        res.status(400).json({ error: "comissaoPersonalizada deve ser null ou um número entre 0 e 100 (no máximo 2 casas decimais)." });
        return;
      }
    }

    // Leitura do valor anterior, atualização e audit na MESMA transação.
    const resultado = await db.transaction(async (tx) => {
      const [user] = await tx
        .select({ id: usersTable.id, username: usersTable.username, tipoConta: usersTable.tipoConta, anterior: usersTable.comissaoPersonalizada })
        .from(usersTable).where(eq(usersTable.id, userId)).for("update").limit(1);
      if (!user) return { erro: 404 as const };
      if (user.tipoConta !== "criador") return { erro: 400 as const };

      const anterior = user.anterior !== null && user.anterior !== undefined ? Number(user.anterior) : null;
      await tx.update(usersTable)
        .set({ comissaoPersonalizada: comissaoPersonalizada !== null ? String(comissaoPersonalizada) : null })
        .where(eq(usersTable.id, userId));
      await tx.insert(auditLogTable).values({
        adminId: req.adminId!,
        action: "set_commission_override",
        targetType: "user",
        targetId: userId,
        details: { username: user.username, anterior, novo: comissaoPersonalizada },
        ipAddress: req.ip ?? null,
      });
      return { username: user.username };
    });

    if ("erro" in resultado) {
      if (resultado.erro === 404) res.status(404).json({ error: "Utilizador não encontrado." });
      else res.status(400).json({ error: "A comissão personalizada só se aplica a criadores." });
      return;
    }

    res.json({
      userId,
      username: resultado.username,
      comissaoPersonalizada,
    });
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao definir comissão personalizada");
    res.status(500).json({ error: "Erro interno." });
  }
});

/**
 * GET /api/admin/users/commission-overview
 * Lista todos os criadores com a sua taxa efectiva actual.
 */
router.get("/admin/users/commission-overview", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  try {
    // Taxa global da base de dados; null = não definida (nada é inventado: as compras respondem 503).
    const globalRate = await lerTaxaGlobal(db);

    const creators = await db
      .select({
        id: usersTable.id,
        username: usersTable.username,
        nomeExibicao: usersTable.nomeExibicao,
        tipoConta: usersTable.tipoConta,
        verificado: usersTable.verificado,
        comissaoPersonalizada: usersTable.comissaoPersonalizada,
      })
      .from(usersTable)
      .where(eq(usersTable.tipoConta, "criador"))
      .orderBy(asc(usersTable.username));

    const result = creators.map((c) => {
      const bruto = c.comissaoPersonalizada;
      const override = bruto !== null && bruto !== undefined ? Number(bruto) : null;
      const overrideValido = override !== null && taxaValida(override);
      // override inválido NÃO cai para a global: o criador fica sem taxa utilizável (compras com 503).
      const taxaEfectiva = override !== null ? (overrideValido ? override : null) : globalRate;
      const fonte = override !== null
        ? (overrideValido ? "personalizada" : "invalida")
        : (globalRate !== null ? "global" : "nao_definida");
      return {
        id: c.id,
        username: c.username,
        nomeExibicao: c.nomeExibicao,
        verificado: c.verificado,
        comissaoPersonalizada: override,
        taxaEfectiva,
        fonte,
        taxaGlobal: globalRate,
      };
    });

    res.json({ taxaGlobal: globalRate, criadores: result });
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao obter commission overview");
    res.status(500).json({ error: "Erro interno." });
  }
});

router.get("/admin/users/:id", async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!user) return void res.status(404).json({ error: "Utilizador não encontrado" });

    const [[{ totalPosts }], [{ totalSeguidores }], [{ totalSeguindo }]] = await Promise.all([
      db.select({ totalPosts: count() }).from(postsTable).where(eq(postsTable.autorId, id)),
      db.select({ totalSeguidores: count() }).from(followsTable).where(eq(followsTable.seguidoId, id)),
      db.select({ totalSeguindo: count() }).from(followsTable).where(eq(followsTable.seguidorId, id)),
    ]);

    // Encerramento pelo próprio: quando, até quando pode ser reaberta (janela de 30 dias) e se ainda pode.
    let encerramento: { encerradaEm: Date; apagarApos: Date; podeReabrir: boolean } | null = null;
    if (user.encerradaEm && !user.banidaEm) {
      const [c] = await db.select({ apagarApos: accountClosuresTable.apagarApos, estado: accountClosuresTable.estado }).from(accountClosuresTable)
        .where(and(eq(accountClosuresTable.userId, id), eq(accountClosuresTable.estado, "pendente"))).limit(1);
      encerramento = c ? { encerradaEm: user.encerradaEm, apagarApos: c.apagarApos, podeReabrir: c.apagarApos.getTime() > Date.now() } : { encerradaEm: user.encerradaEm, apagarApos: user.encerradaEm, podeReabrir: false };
    }

    const casoMenor = await casoAtivoDaConta(db, id);

    res.json({
      ...mapUser(user),
      casoMenor,
      totalPosts: Number(totalPosts),
      totalSeguidores: Number(totalSeguidores),
      totalSeguindo: Number(totalSeguindo),
      encerramento,
    });
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao obter utilizador");
    res.status(500).json({ error: "Erro interno." });
  }
});

router.patch("/admin/users/:id", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!user) return void res.status(404).json({ error: "Utilizador não encontrado" });

    const CAMPOS_PERMITIDOS = ["nomeExibicao", "bio", "verificado"] as const;
    const before: Record<string, unknown> = {};
    const updates: Record<string, unknown> = {};
    for (const campo of CAMPOS_PERMITIDOS) {
      if (req.body[campo] !== undefined) {
        before[campo] = user[campo];
        updates[campo] = req.body[campo];
      }
    }
    if (Object.keys(updates).length === 0) {
      return void res.status(400).json({ error: "Nenhum campo válido para actualizar." });
    }

    const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
    await logAudit(req, "user_edit", "user", id, { before, after: updates });
    res.json(mapUser(updated));
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao editar utilizador");
    res.status(500).json({ error: "Erro interno." });
  }
});

router.patch("/admin/users/:id/status", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!user) return void res.status(404).json({ error: "Utilizador não encontrado" });

    // Conta banida: definitiva. Nem suspende, nem reativa, nem reabre.
    if (user.banidaEm) {
      return void res.status(409).json({ error: "Esta conta está banida de forma permanente: não se suspende, não se reativa nem se reabre." });
    }

    // Conta encerrada pelo próprio: nem suspende nem reativa; só se reabre (POST /admin/users/:id/reabrir).
    if (user.encerradaEm) {
      return void res.status(409).json({ error: "Esta conta foi encerrada pelo próprio utilizador: não se suspende nem se reativa. Se for para a reabrir, usa «Reabrir conta» (dentro dos 30 dias)." });
    }

    const { estado } = req.body;
    if (!["ativo", "suspenso"].includes(estado)) {
      return void res.status(400).json({ error: "Estado inválido. Use 'ativo' ou 'suspenso'." });
    }
    const novoAtivo = estado === "ativo";
    const estadoAnterior = mapEstado(user.ativo, user.encerradaEm, user.banidaEm);

    if (!novoAtivo) {
      if (user.id === req.adminId) {
        return void res.status(403).json({ error: "Não podes suspender a tua própria conta." });
      }
      if (user.role === "admin" || user.role === "superadmin") {
        return void res.status(403).json({ error: "Não é possível suspender uma conta de administrador." });
      }
    }

    // Suspender: ativo=false + sessões e refresh tokens revogados (função partilhada), tudo numa transação com o audit.
    // Reativar: só ativo=true (o utilizador tem de fazer login outra vez; as sessões antigas continuam revogadas).
    const updated = await db.transaction(async (tx) => {
      if (novoAtivo) {
        const [u] = await tx.update(usersTable).set({ ativo: true }).where(eq(usersTable.id, id)).returning();
        await tx.insert(auditLogTable).values({
          adminId: req.adminId!, action: "user_reactivate", targetType: "user", targetId: id,
          details: { before: { estado: estadoAnterior }, after: { estado } }, ipAddress: req.ip ?? null,
        });
        return u;
      }
      await suspenderConta(tx, id, { adminId: req.adminId!, ip: req.ip ?? null, origem: "admin" });
      const [u] = await tx.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
      await tx.insert(auditLogTable).values({
        adminId: req.adminId!, action: "user_suspend", targetType: "user", targetId: id,
        details: { before: { estado: estadoAnterior }, after: { estado } }, ipAddress: req.ip ?? null,
      });
      return u;
    });
    if (!novoAtivo) desligarSockets(id);
    res.json(mapUser(updated));
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao alterar estado do utilizador");
    res.status(500).json({ error: "Erro interno." });
  }
});

router.patch("/admin/users/:id/role", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!user) return void res.status(404).json({ error: "Utilizador não encontrado" });

    const novoRole: string = req.body.role;
    const ROLES_VALIDAS = ["user", "creator", "admin", "superadmin"] as const;
    if (!ROLES_VALIDAS.includes(novoRole as any)) {
      return void res.status(400).json({ error: `Role inválida. Valores permitidos: ${ROLES_VALIDAS.join(", ")}` });
    }
    if ((novoRole === "admin" || novoRole === "superadmin") && req.adminRole !== "superadmin") {
      return void res.status(403).json({ error: "Apenas superadmin pode atribuir roles de administrador" });
    }
    if (user.role === "superadmin" && req.adminRole !== "superadmin") {
      return void res.status(403).json({ error: "Não é possível alterar a role de um superadmin" });
    }
    if (user.id === req.adminId && novoRole === "superadmin" && req.adminRole !== "superadmin") {
      return void res.status(403).json({ error: "Não podes promover-te a superadmin" });
    }

    const roleAnterior = user.role;
    const [updated] = await db.update(usersTable).set({ role: novoRole }).where(eq(usersTable.id, id)).returning();
    await logAudit(req, "user_role_change", "user", id, { before: { role: roleAnterior }, after: { role: novoRole } });
    res.json(mapUser(updated));
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao alterar role");
    res.status(500).json({ error: "Erro interno." });
  }
});

router.delete("/admin/users/:id", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!user) return void res.status(404).json({ error: "Utilizador não encontrado" });

    // Mesmas proteções do PATCH de estado: nem a própria conta nem contas de administrador.
    if (user.id === req.adminId) {
      return void res.status(403).json({ error: "Não podes eliminar a tua própria conta." });
    }
    if (user.role === "admin" || user.role === "superadmin") {
      return void res.status(403).json({ error: "Não é possível eliminar uma conta de administrador." });
    }

    // Soft delete — desactiva a conta sem eliminar os dados (mesma suspensão partilhada: revoga sessões e refresh tokens)
    await db.transaction(async (tx) => {
      await suspenderConta(tx, id, { adminId: req.adminId!, ip: req.ip ?? null, origem: "eliminacao" });
      await tx.insert(auditLogTable).values({
        adminId: req.adminId!, action: "user_delete", targetType: "user", targetId: id,
        details: { before: { ativo: user.ativo }, after: { ativo: false } }, ipAddress: req.ip ?? null,
      });
    });
    desligarSockets(id);
    res.json({ success: true });
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao eliminar utilizador");
    res.status(500).json({ error: "Erro interno." });
  }
});

/**
 * Bane uma conta de forma permanente. Motivo obrigatório (10 a 500 caracteres). Transação única (lib/banimento.ts):
 * ativo=false + banida_em, sessões/tokens revogados, hashes do email e do documento bloqueados, audit. Sem BAN_HASH_PEPPER
 * recusa com erro claro (503) e não altera nada. Nunca escreve email, documento nem hash em respostas ou logs.
 */
router.post("/admin/users/:id/banir", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return void res.status(400).json({ error: "ID inválido" });
  const motivo = typeof req.body?.motivo === "string" ? req.body.motivo.trim() : "";
  if (motivo.length < 10 || motivo.length > 500) {
    return void res.status(400).json({ error: "Indica o motivo do banimento (entre 10 e 500 caracteres)." });
  }
  try {
    await banirConta({ userId: id, adminId: req.adminId!, motivo, ip: (req.ip ?? "").slice(0, 45) || null });
    desligarSockets(id);
    res.json({ success: true });
  } catch (err) {
    if (err instanceof BanimentoErro) return void res.status(err.httpStatus).json({ error: err.message, ...(err.codigo ? { codigo: err.codigo } : {}) });
    (req as any).log?.error(erroSeguro(err), "Erro ao banir conta");
    res.status(500).json({ error: "Erro interno." });
  }
});

/**
 * Reabre uma conta encerrada pelo próprio utilizador, dentro da janela de 30 dias. Motivo obrigatório (10 a 500
 * caracteres), audit na mesma transação. Repõe ativo=true e encerrada_em=null e marca a fila como reaberta; NÃO repõe
 * sessões, subscrições nem lives.
 */
router.post("/admin/users/:id/reabrir", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return void res.status(400).json({ error: "ID inválido" });
  const motivo = typeof req.body?.motivo === "string" ? req.body.motivo.trim() : "";
  if (motivo.length < 10 || motivo.length > 500) {
    return void res.status(400).json({ error: "Indica o motivo da reabertura (entre 10 e 500 caracteres)." });
  }
  try {
    await reabrirConta({ userId: id, adminId: req.adminId!, motivo, ip: (req.ip ?? "").slice(0, 45) || null });
    res.json({ success: true });
  } catch (err) {
    if (err instanceof EncerramentoErro) return void res.status(err.httpStatus).json({ error: err.message });
    (req as any).log?.error(erroSeguro(err), "Erro ao reabrir conta");
    res.status(500).json({ error: "Erro interno." });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// CREATORS
// ────────────────────────────────────────────────────────────────────────────

router.get("/admin/creators", async (req, res) => {
  try {
    const { page = "1", limit = "10", search } = req.query as Record<string, string>;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions: any[] = [eq(usersTable.tipoConta, "criador")];
    if (search) {
      conditions.push(or(
        ilike(usersTable.username, `%${search}%`),
        ilike(usersTable.nomeExibicao, `%${search}%`),
      ));
    }
    const where = and(...conditions);

    const [rows, [{ total }]] = await Promise.all([
      db.select().from(usersTable).where(where).orderBy(desc(usersTable.ganhos)).limit(limitNum).offset(offset),
      db.select({ total: count() }).from(usersTable).where(where),
    ]);

    // Contar subscritores por criador
    const ids = rows.map(r => r.id);
    const subsCounts = ids.length > 0
      ? await db.execute(sql`
          SELECT criador_id, COUNT(*)::int AS total
          FROM subscriptions
          WHERE criador_id = ANY(${sql.raw(`ARRAY[${ids.join(",")}]`)})
            AND estado = 'ativa'
          GROUP BY criador_id
        `)
      : { rows: [] };

    const subsMap = new Map<number, number>();
    for (const r of (subsCounts as any).rows ?? []) {
      subsMap.set(r.criador_id, r.total);
    }

    res.json(paginate(
      rows.map(u => ({ ...mapUser(u), subscribers: subsMap.get(u.id) ?? 0 })),
      Number(total), pageNum, limitNum
    ));
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao listar criadores");
    res.status(500).json({ error: "Erro interno." });
  }
});

// A fila só leva o caminho do endpoint que gera o URL (60 s na zona privada, proxy assinado nos
// registos antigos): qualquer visualização passa por ele e fica no audit_log.
function kycAccess(submissionId: number, tipo: string, _key: string): string {
  return `/api/admin/kyc/${submissionId}/${tipo}`;
}

router.get("/admin/creators/kyc-queue", requireAdmin, async (req: AdminRequest, res) => {
  try {
    const queue = await db
      .select()
      .from(usersTable)
      .where(and(eq(usersTable.tipoConta, "criador"), eq(usersTable.verificado, false), eq(usersTable.ativo, true)))
      .orderBy(asc(usersTable.criadoEm));

    const userIds = queue.map((user) => user.id);
    const submissions = userIds.length > 0
      ? await db.select().from(kycSubmissionsTable).where(inArray(kycSubmissionsTable.userId, userIds))
      : [];
    const submissionByUser = new Map(submissions.map((submission) => [submission.userId, submission]));

    // Aceite dos Termos para Criadoras da submissão mostrada (só leitura; sem IP nem User-Agent). Sem linha = conta anterior.
    const submissionIds = [...submissionByUser.values()].map((submission) => submission.id);
    const aceites = submissionIds.length > 0
      ? await db.select({ kycSubmissionId: creatorTermsAcceptancesTable.kycSubmissionId, versao: creatorTermsAcceptancesTable.versao, aceiteEm: creatorTermsAcceptancesTable.aceiteEm })
          .from(creatorTermsAcceptancesTable).where(inArray(creatorTermsAcceptancesTable.kycSubmissionId, submissionIds))
      : [];
    const aceiteBySubmission = new Map(aceites.map((a) => [a.kycSubmissionId, a]));

    res.json(queue.map(u => {
      const submission = submissionByUser.get(u.id);
      const aceite = submission ? aceiteBySubmission.get(submission.id) : undefined;
      return {
        ...mapUser(u),
        termosCriadoras: aceite ? { versao: aceite.versao, aceiteEm: aceite.aceiteEm } : null,
        kycSubmissao: submission ? {
          documentoFrente: kycAccess(submission.id, "documento", submission.documentoKey),
          documentoVerso: null,
          selfie: kycAccess(submission.id, "selfie", submission.selfieKey),
          provaDeMorada: null,
          selfieComDocumento: null,
          videoVerificacao: kycAccess(submission.id, "liveness", submission.livenessKey),
          submissaoEm: submission.submetidoEm,
        } : null,
      };
    }));
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao obter fila KYC");
    res.status(500).json({ error: "Erro interno." });
  }
});

// URL de curta duração (60 s) para ver um documento KYC. Só admin; cada pedido gera um URL novo e fica
// registado no audit_log (sem o URL). Se o registo falhar, o acesso é recusado.
router.get("/admin/kyc/:submissionId/:tipo", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const submissionId = Number(req.params.submissionId);
  const tipo = String(req.params.tipo);
  const column = ({ documento: "documentoKey", selfie: "selfieKey", liveness: "livenessKey" } as const)[tipo as "documento"];
  if (!Number.isInteger(submissionId) || submissionId <= 0 || !column) {
    return void res.status(400).json({ error: "Pedido inválido." });
  }
  try {
    const [submission] = await db.select().from(kycSubmissionsTable).where(eq(kycSubmissionsTable.id, submissionId)).limit(1);
    if (!submission) return void res.status(404).json({ error: "Submissão não encontrada." });

    const key = submission[column];
    const privado = isPrivateStorageKey(key);
    await db.insert(auditLogTable).values({
      adminId: req.adminId!,
      action: "kyc_documento_visto",
      targetType: "user",
      targetId: submission.userId,
      details: { submissionId, tipo, zona: privado ? "privada" : "publica_legada" },
      ipAddress: req.ip ?? null,
    });

    res.setHeader("Cache-Control", "no-store");
    if (privado) {
      const { url, expiresAt } = getPrivateSignedUrl(key, 60);
      return void res.json({ url, expiraEm: expiresAt.toISOString() });
    }
    res.json({ url: signMediaUrl(getPublicUrl(key)), expiraEm: new Date(Date.now() + 15 * 60_000).toISOString() });
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao gerar acesso a documento KYC");
    res.status(500).json({ error: "Erro interno." });
  }
});

/** Motivo da recusa de KYC: 10 a 500 caracteres; nunca números de documento (6+ dígitos seguidos) nem emails. */
const MSG_MOTIVO_KYC_INVALIDO = "O motivo não pode conter números de documento nem emails";

router.patch("/admin/creators/:id/kyc", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const [user] = await db.select().from(usersTable)
      .where(and(eq(usersTable.id, id), eq(usersTable.tipoConta, "criador"))).limit(1);
    if (!user) return void res.status(404).json({ error: "Criador não encontrado" });

    const acao = req.body?.acao ?? (req.body?.status === "aprovado" ? "aprovar" : req.body?.status === "rejeitado" ? "rejeitar" : undefined);
    if (!["aprovar", "rejeitar"].includes(acao)) {
      return void res.status(400).json({ error: "Acção inválida. Use 'aprovar' ou 'rejeitar'." });
    }

    // Motivo opcional no servidor; se vier (na recusa), 10 a 500 caracteres e sem dados sensíveis (rede de segurança).
    const bruto = req.body?.motivo ?? req.body?.reason;
    if (bruto !== undefined && bruto !== null && typeof bruto !== "string") {
      return void res.status(400).json({ error: "Motivo inválido." });
    }
    const motivo = acao === "rejeitar" && typeof bruto === "string" && bruto.trim() ? bruto.trim() : null;
    if (motivo !== null) {
      if (motivo.length < 10 || motivo.length > 500) {
        return void res.status(400).json({ error: "O motivo deve ter entre 10 e 500 caracteres." });
      }
      if (/\d{6,}/.test(motivo) || motivo.includes("@")) {
        return void res.status(400).json({ error: MSG_MOTIVO_KYC_INVALIDO });
      }
    }

    // Transação única: utilizador, submissão, audit e notificação. Se uma falhar, reverte tudo.
    const updated = await db.transaction(async (tx) => {
      const [u] = await tx.update(usersTable)
        .set(acao === "aprovar" ? { verificado: true, tipoConta: "criador" as const } : { verificado: false, tipoConta: "pessoal" as const })
        .where(eq(usersTable.id, id))
        .returning();

      // Nota: aprova/recusa mesmo sem submissão pendente (comportamento anterior mantido).
      const [submission] = await tx.select({ id: kycSubmissionsTable.id })
        .from(kycSubmissionsTable)
        .where(and(eq(kycSubmissionsTable.userId, id), eq(kycSubmissionsTable.status, "pendente")))
        .orderBy(sql`${kycSubmissionsTable.submetidoEm} DESC`)
        .limit(1);
      if (submission) {
        await tx.update(kycSubmissionsTable)
          .set({
            status: acao === "aprovar" ? "aprovado" : "rejeitado",
            motivoRejeicao: motivo,
            revistoEm: new Date(),
            revistoPor: req.adminId!,
          })
          .where(eq(kycSubmissionsTable.id, submission.id));
      }

      await tx.insert(auditLogTable).values({
        adminId: req.adminId!, action: `kyc_${acao}`, targetType: "user", targetId: id,
        details: { before: { verificado: user.verificado }, after: { verificado: u.verificado }, motivo },
        ipAddress: req.ip ?? null,
      });

      // Resultado para a criadora, na interface (sem dados sensíveis: nada de documento, nome ou números).
      await notificarSistema(tx, id, acao === "aprovar"
        ? "A tua verificação de identidade foi aprovada. Já podes usar a tua conta de criadora."
        : `A tua verificação de identidade não foi aprovada.${motivo ? ` Motivo: ${motivo.replace(/[.\s]+$/, "")}.` : ""} Podes submeter de novo em «Tornar-se Criador».`);
      return u;
    });
    res.json({ success: true, user: mapUser(updated) });
  } catch (err) {
    (req as any).log?.error(erroSeguro(err), "Erro ao processar KYC");
    res.status(500).json({ error: "Erro interno." });
  }
});

router.get("/admin/creators/:id/plans", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const plans = await db.select().from(subscriptionPlansTable)
      .where(eq(subscriptionPlansTable.criadorId, id))
      .orderBy(asc(subscriptionPlansTable.preco));

    // Contar subscritores activos por plano
    const planIds = plans.map(p => p.id);
    const subsCount = planIds.length > 0
      ? await db.execute(sql`
          SELECT plano_id, COUNT(*)::int AS total
          FROM subscriptions
          WHERE plano_id = ANY(${sql.raw(`ARRAY[${planIds.join(",")}]`)})
            AND estado = 'ativa'
          GROUP BY plano_id
        `)
      : { rows: [] };

    const subsMap = new Map<number, number>();
    for (const r of (subsCount as any).rows ?? []) {
      subsMap.set(r.plano_id, r.total);
    }

    res.json(plans.map(p => ({
      ...p,
      preco: Number(p.preco),
      totalSubscritores: subsMap.get(p.id) ?? 0,
    })));
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao listar planos do criador");
    res.status(500).json({ error: "Erro interno." });
  }
});

router.patch("/admin/creators/:id/plans/:planId", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  try {
    const planId = Number(req.params.planId);
    const [plan] = await db.select().from(subscriptionPlansTable)
      .where(eq(subscriptionPlansTable.id, planId)).limit(1);
    if (!plan) return void res.status(404).json({ error: "Plano não encontrado" });

    const before = { ...plan };
    const updates: Partial<typeof subscriptionPlansTable.$inferInsert> = {};
    if (req.body.nome !== undefined) updates.nome = String(req.body.nome);
    if (req.body.preco !== undefined) updates.preco = String(Number(req.body.preco));
    if (req.body.beneficios !== undefined) updates.beneficios = String(req.body.beneficios);
    if (req.body.ativo !== undefined) updates.ativo = Boolean(req.body.ativo);

    const [updated] = await db.update(subscriptionPlansTable).set(updates)
      .where(eq(subscriptionPlansTable.id, planId)).returning();
    await logAudit(req, "plan_edit", "plan", planId, { before, after: updates });
    res.json({ success: true, ...updated, preco: Number(updated.preco) });
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao editar plano");
    res.status(500).json({ error: "Erro interno." });
  }
});

router.post("/admin/creators/:id/balance-adjustment", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const { valor, motivo } = req.body;
    const valorNum = Number(valor);

    // A linha do criador bloqueia-se (FOR UPDATE) ANTES de ler o saldo e de calcular o novo valor: um débito/crédito concorrente
    // (gorjeta, compra, carregamento) espera pelo ajuste em vez de ser sobrescrito por um saldo calculado com um valor antigo.
    const r = await db.transaction(async (tx) => {
      const [user] = await tx.select().from(usersTable)
        .where(and(eq(usersTable.id, id), eq(usersTable.tipoConta, "criador"))).limit(1).for("update");
      if (!user) return { erro: 404 as const };
      if (!Number.isFinite(valorNum)) return { erro: 400 as const };

      const saldoAnterior = Number(user.saldo);
      const novoSaldo = saldoAnterior + valorNum;
      await tx.update(usersTable).set({ saldo: String(novoSaldo) }).where(eq(usersTable.id, id));
      return { saldoAnterior, novoSaldo };
    });
    if ("erro" in r) {
      return void (r.erro === 404 ? res.status(404).json({ error: "Criador não encontrado" }) : res.status(400).json({ error: "Valor inválido." }));
    }
    const { saldoAnterior, novoSaldo } = r;

    await logAudit(req, "balance_adjustment", "user", id, {
      before: { saldo: saldoAnterior }, after: { saldo: novoSaldo }, valor: valorNum, motivo: motivo ?? null,
    });
    res.json({ success: true, novoSaldo });
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao ajustar saldo");
    res.status(500).json({ error: "Erro interno." });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// CONTENT & REPORTS
// ────────────────────────────────────────────────────────────────────────────

router.get("/admin/posts", async (req, res) => {
  try {
    const { page = "1", limit = "10", search } = req.query as Record<string, string>;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions: any[] = [];
    if (search) conditions.push(ilike(postsTable.legenda, `%${search}%`));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      db.select({
        id: postsTable.id,
        autorId: postsTable.autorId,
        autorUsername: usersTable.username,
        autorAvatar: usersTable.avatarUrl,
        legenda: postsTable.legenda,
        tipo: postsTable.tipo,
        exclusivo: postsTable.exclusivo,
        mais18: postsTable.mais18,
        criadoEm: postsTable.criadoEm,
      })
        .from(postsTable)
        .leftJoin(usersTable, eq(postsTable.autorId, usersTable.id))
        .where(where)
        .orderBy(desc(postsTable.criadoEm))
        .limit(limitNum)
        .offset(offset),
      db.select({ total: count() }).from(postsTable).where(where),
    ]);

    // Capa: primeira media (por ordem) de cada post PÚBLICO, numa só query. Posts exclusivos (media em "paid/")
    // nunca são lidos nem devolvidos: capaUrl/capaTipo = null (a media paga só se vê no diálogo de denúncia).
    const idsPublicos = rows.filter((r) => !r.exclusivo).map((r) => r.id);
    const capas = new Map<number, { url: string; tipo: string }>();
    if (idsPublicos.length > 0) {
      const medias = await db.select({ postId: postMediaTable.postId, url: postMediaTable.url, tipo: postMediaTable.tipo })
        .from(postMediaTable)
        .where(inArray(postMediaTable.postId, idsPublicos))
        .orderBy(asc(postMediaTable.postId), asc(postMediaTable.ordem), asc(postMediaTable.id));
      for (const m of medias) if (!capas.has(m.postId) && !isPaidKey(m.url)) capas.set(m.postId, { url: m.url, tipo: m.tipo });
    }

    res.json(paginate(rows.map((r) => {
      const capa = r.exclusivo ? undefined : capas.get(r.id);
      return {
        ...r,
        autorAvatar: urlMedia(r.autorAvatar),
        capaUrl: capa ? resolveMediaUrl(capa.url) || null : null,
        capaTipo: capa ? capa.tipo : null,
      };
    }), Number(total), pageNum, limitNum));
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao listar posts");
    res.status(500).json({ error: "Erro interno." });
  }
});

router.delete("/admin/posts/:id", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return void res.status(400).json({ error: "ID inválido" });
  // Motivo obrigatório (fica no audit_log, na mesma transação da eliminação).
  const motivo = typeof req.body?.motivo === "string" ? req.body.motivo.trim() : "";
  if (motivo.length < 10 || motivo.length > 500) {
    return void res.status(400).json({ error: "Indica o motivo da eliminação (entre 10 e 500 caracteres)." });
  }
  try {
    await eliminarPost({ postId: id, userId: req.adminId!, ator: "admin", motivo, ip: (req.ip ?? "").slice(0, 45) || null });
    res.json({ success: true });
  } catch (err) {
    responderErroEliminacao(err, res, (req as any).log);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// DENÚNCIAS E RETIRADA DE CONTEÚDO (takedown)
// Retirar = esconder (nada é apagado, ficheiros retidos). Decisão + retirada + suspensão + notificações +
// audit_log acontecem na MESMA transação: se qualquer passo falhar, nada fica feito.
// ────────────────────────────────────────────────────────────────────────────

const REPORT_STATUSES = ["pendente", "em_analise", "procedente", "improcedente"] as const;
type ReportStatus = typeof REPORT_STATUSES[number];
/** Máquina de estados rígida: procedente e improcedente são finais. */
const REPORT_TRANSITIONS: Record<ReportStatus, ReportStatus[]> = {
  pendente: ["em_analise", "procedente", "improcedente"],
  em_analise: ["procedente", "improcedente"],
  procedente: [],
  improcedente: [],
};

router.get("/admin/reports", async (req, res) => {
  try {
    const { page = "1", limit = "10", targetType, status, reason, urgente } = req.query as Record<string, string>;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const offset = (pageNum - 1) * limitNum;

    if (status && !REPORT_STATUSES.includes(status as ReportStatus)) {
      return void res.status(400).json({ error: `Estado inválido. Valores permitidos: ${REPORT_STATUSES.join(", ")}` });
    }
    if (targetType && !TARGET_TYPES.includes(targetType as TargetType)) {
      return void res.status(400).json({ error: `Tipo inválido. Valores permitidos: ${TARGET_TYPES.join(", ")}` });
    }

    const conditions: any[] = [];
    if (targetType) conditions.push(eq(reportsTable.targetType, targetType as TargetType));
    if (status) conditions.push(eq(reportsTable.status, status as ReportStatus));
    if (reason) conditions.push(eq(reportsTable.reason, reason));
    if (urgente === "1") conditions.push(eq(reportsTable.urgente, true));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      db.select({
        id: reportsTable.id,
        reporterId: reportsTable.reporterId,
        reporterUsername: usersTable.username,
        anonimo: sql<boolean>`${reportsTable.reporterId} IS NULL`,
        targetType: reportsTable.targetType,
        targetId: reportsTable.targetId,
        targetOwnerId: reportsTable.targetOwnerId,
        reason: reportsTable.reason,
        urgente: reportsTable.urgente,
        description: reportsTable.description,
        adminNotes: reportsTable.adminNotes,
        status: reportsTable.status,
        acaoRetirou: reportsTable.acaoRetirou,
        acaoSuspendeu: reportsTable.acaoSuspendeu,
        resolvedBy: reportsTable.resolvedBy,
        resolvedAt: reportsTable.resolvedAt,
        criadoEm: reportsTable.criadoEm,
        // reporter_contact e reporter_ip só no detalhe / nunca (o IP não sai da BD)
      })
        .from(reportsTable)
        .leftJoin(usersTable, eq(reportsTable.reporterId, usersTable.id))
        .where(where)
        .orderBy(desc(reportsTable.urgente), desc(reportsTable.criadoEm))
        .limit(limitNum)
        .offset(offset),
      db.select({ total: count() }).from(reportsTable).where(where),
    ]);

    res.json(paginate(rows, Number(total), pageNum, limitNum));
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao listar denúncias");
    res.status(500).json({ error: "Erro interno." });
  }
});

// Detalhe: denúncia + conteúdo denunciado (URLs assinados de curta duração para o média privado).
// Cada visualização grava audit_log na MESMA transação: se o registo falhar, o conteúdo não é devolvido.
router.get("/admin/reports/:id", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return void res.status(400).json({ error: "ID inválido" });

    const out = await db.transaction(async (tx) => {
      const [r] = await tx.select().from(reportsTable).where(eq(reportsTable.id, id)).limit(1);
      if (!r) throw new TakedownError("Denúncia não encontrada", 404);
      const alvo = alvoSuportado(r.targetType) ? await lerAlvo(tx, r.targetType, r.targetId) : null; // denúncia antiga de reel: sem conteúdo
      const [dono] = r.targetOwnerId
        ? await tx.select({ id: usersTable.id, username: usersTable.username, ativo: usersTable.ativo }).from(usersTable).where(eq(usersTable.id, r.targetOwnerId))
        : [];
      const [{ outras }] = await tx.select({ outras: count() }).from(reportsTable)
        .where(and(eq(reportsTable.targetType, r.targetType), eq(reportsTable.targetId, r.targetId)));
      // Mensagem: estado da retirada (quem, quando, porquê) e se pode ser reposta
      const retiradaMsg = r.targetType === "mensagem" ? await estadoRetiradaMensagem(tx, { id: r.id, targetId: r.targetId, status: r.status }) : null;

      await tx.insert(auditLogTable).values({
        adminId: req.adminId!, action: "report_conteudo_visto", targetType: "report", targetId: id,
        details: { alvo: { tipo: r.targetType, id: r.targetId } }, ipAddress: req.ip ?? null,
      });

      // Provas de um caso de menor: cada acesso fica registado também como `menor_caso_visto` (cadeia de custódia).
      if (r.reason === "menor") {
        await tx.insert(auditLogTable).values({
          adminId: req.adminId!, action: "menor_caso_visto", targetType: "report", targetId: id,
          details: { parte: "denuncia" }, ipAddress: req.ip ?? null,
        });
      }
      const casoMenor = r.targetOwnerId && r.reason === "menor" ? await casoAtivoDaConta(tx, r.targetOwnerId) : null;

      const media = (alvo?.media ?? []).map((m) => {
        // Média privado ("paid/..."): URL assinado de 5 minutos (nunca guardado nem registado)
        if (isPaidKey(m.url)) {
          return { tipo: m.tipo, url: isPrivateStorageConfigured() ? getPrivateSignedUrl(m.url, 300).url : null };
        }
        return { tipo: m.tipo, url: urlMedia(m.url) };
      });
      const { reporterIp: _ip, ...rSemIp } = r;
      return {
        ...rSemIp,
        reporterUsername: r.reporterId ? (await tx.select({ u: usersTable.username }).from(usersTable).where(eq(usersTable.id, r.reporterId)))[0]?.u ?? null : null,
        totalDenunciasDoAlvo: Number(outras),
        casoMenor,
        alvo: alvo ? {
          existe: true, removido: alvo.removido, mais18: alvo.mais18 ?? null, resumo: alvo.resumo, media, dono: dono ?? null, enquete: alvo.enquete ?? null,
          // Mensagem: o excerto CONGELADO (janela de contexto + cópias das imagens por URL assinado de curta duração), nunca a conversa viva
          ...(r.targetType === "mensagem" ? { mensagem: (() => {
            const ex = excertoParaAdmin(r.alvoSnapshot, (k) => (isPrivateStorageConfigured() ? getPrivateSignedUrl(k, PROVA_URL_TTL_SECONDS).url : null));
            // O excerto é congelado; só o estado "retirada" da mensagem denunciada acompanha o estado vivo (retirada/reposição).
            if (ex && Array.isArray(ex.mensagens)) ex.mensagens = (ex.mensagens as any[]).map((m) => (m.id === ex.mensagemId ? { ...m, retirada: alvo.removido } : m));
            return ex;
          })(), retiradaMensagem: retiradaMsg } : {}),
        } : { existe: false },
      };
    });

    res.set("Cache-Control", "no-store");
    res.json(out);
  } catch (err) {
    if (err instanceof TakedownError) return void res.status(err.httpStatus).json({ error: err.message });
    (req as any).log?.error({ err }, "Erro ao obter denúncia");
    res.status(500).json({ error: "Erro interno." });
  }
});

router.patch("/admin/reports/:id", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return void res.status(400).json({ error: "ID inválido" });

    const novo = req.body?.status as ReportStatus;
    if (!REPORT_STATUSES.includes(novo) || novo === "pendente") {
      return void res.status(400).json({ error: "Estado inválido. Valores permitidos: em_analise, procedente, improcedente" });
    }
    const notas = typeof req.body.notes === "string" ? req.body.notes.slice(0, 1000) : undefined; // internas
    const motivo = typeof req.body.motivo === "string" ? req.body.motivo.trim().slice(0, 300) : ""; // visível ao autor
    const a = req.body.acoes ?? {};
    const acoes = {
      retirar: a.retirar === true,
      suspender: a.suspender === true,
      avisarAutor: a.avisarAutor === true,
      avisarDenunciante: a.avisarDenunciante === true,
      marcarMais18: a.marcarMais18 === true,
    };
    if (novo !== "procedente" && (acoes.retirar || acoes.suspender)) {
      return void res.status(400).json({ error: "Só uma denúncia procedente pode retirar conteúdo ou suspender o autor." });
    }
    if (acoes.marcarMais18) {
      if (novo !== "procedente") return void res.status(400).json({ error: "Só uma denúncia procedente pode marcar o conteúdo como +18." });
      if (acoes.retirar || acoes.suspender) {
        return void res.status(400).json({ error: "Marcar +18 já aplica a sanção da infração: não o combines com retirar o conteúdo nem com suspender o autor." });
      }
    }

    // Resultado da marcação +18 (infração), para os efeitos fora da base de dados DEPOIS do commit
    let marcacaoMais18: Awaited<ReturnType<typeof marcarMais18PorAdmin>> | null = null;
    // Reposição automática da mensagem (improcedente depois de retirada automática)
    let reposicao: { feita: boolean; impedimento: string | null } | null = null;

    const updated = await db.transaction(async (tx) => {
      const [r] = await tx.select().from(reportsTable).where(eq(reportsTable.id, id)).for("update");
      if (!r) throw new TakedownError("Denúncia não encontrada", 404);
      // Estado lido DEPOIS do lock: dois PATCH em simultâneo não passam ambos
      if (!REPORT_TRANSITIONS[r.status].includes(novo)) {
        throw new TakedownError(`Transição inválida: ${r.status} → ${novo}`, 409);
      }

      // Denúncia antiga com alvo "reel" (tipo removido): pode ser fechada, mas não há conteúdo a retirar nem a marcar
      if (!alvoSuportado(r.targetType) && (acoes.retirar || acoes.marcarMais18)) {
        throw new TakedownError("O conteúdo desta denúncia era um reel e esse tipo já não existe: não há nada a retirar nem a marcar.", 409);
      }
      const final = novo === "procedente" || novo === "improcedente";
      let retirou = false, suspendeu = false;
      const ownerId = r.targetOwnerId;
      const motivoRetirada = motivo || "Violação das regras da plataforma.";

      let infracaoAudit: { infracaoId: number; numero: number; acao: string } | false = false;
      // Marcar +18 e registar a infração à criadora (lib partilhada, NESTA transação: se algo falhar, a decisão inteira reverte).
      if (acoes.marcarMais18) {
        if (!isTipoMais18(r.targetType)) throw new TakedownError("Marcar +18 só se aplica a publicações, stories e lives.", 400);
        const m = await marcarMais18PorAdmin(tx, {
          adminId: req.adminId!, ip: req.ip ?? null, tipo: r.targetType, conteudoId: r.targetId,
          mais18: true, infracao: true, motivo: motivo || null, reportId: id, origem: "denuncia",
        });
        if (!m.infracao) {
          throw new TakedownError(m.semInfracaoPorque === "infracao_ja_ativa"
            ? "Este conteúdo já tem uma infração +18 ativa: não se regista outra."
            : "Este conteúdo já está marcado como +18: não há infração a registar.", 409);
        }
        marcacaoMais18 = m;
        infracaoAudit = { infracaoId: m.infracao.id, numero: m.infracao.numero, acao: m.infracao.acao };
        if (m.suspendeu) suspendeu = true; // a infração suspendeu a conta: fica no registo da denúncia (acaoSuspendeu)
      }

      if (acoes.retirar) {
        const res1 = await retirarAlvo(tx, r.targetType as TargetType, r.targetId, req.adminId!, motivoRetirada);
        retirou = true;
        if (res1.mudou) {
          await tx.insert(auditLogTable).values({
            adminId: req.adminId!, action: "conteudo_retirado", targetType: r.targetType, targetId: r.targetId,
            details: { reportId: id, motivo: motivoRetirada }, ipAddress: req.ip ?? null,
          });
        }
      }
      if (acoes.suspender && ownerId && !(acoes.retirar && r.targetType === "user")) {
        const res2 = await retirarAlvo(tx, "user", ownerId, req.adminId!, motivoRetirada);
        suspendeu = true;
        if (res2.mudou) {
          await tx.insert(auditLogTable).values({
            adminId: req.adminId!, action: "user_suspend", targetType: "user", targetId: ownerId,
            details: { reportId: id, motivo: motivoRetirada }, ipAddress: req.ip ?? null,
          });
        }
      }
      if (r.targetType === "user" && acoes.retirar) suspendeu = true;

      // Notificações (sem dados de quem denunciou)
      // Com marcarMais18 o aviso da infração (já enviado pela lib) substitui a notificação genérica ao autor
      if (ownerId && (acoes.avisarAutor || retirou || suspendeu) && final && !acoes.marcarMais18) {
        const label = rotuloAlvo(r.targetType);
        const partes: string[] = [];
        if (retirou && r.targetType !== "user") partes.push(`O teu ${label} foi retirado por violar as regras da plataforma.`);
        if (suspendeu) partes.push("A tua conta foi suspensa por violação das regras da plataforma.");
        if (!retirou && !suspendeu) partes.push(`Recebemos uma denúncia sobre o teu ${label} e analisámo-la. Lembra-te de cumprir as regras da plataforma.`);
        if (motivo) partes.push(`Motivo: ${motivo}.`);
        await notificarSistema(tx, ownerId, partes.join(" "));
      }
      if (r.reporterId && acoes.avisarDenunciante && final) {
        await notificarSistema(tx, r.reporterId, novo === "procedente"
          ? "Obrigado pela tua denúncia. Analisámos e tomámos medidas sobre o conteúdo."
          : "Obrigado pela tua denúncia. Analisámos e, neste caso, não foi necessária qualquer ação.");
      }

      const [u] = await tx.update(reportsTable).set({
        status: novo,
        ...(notas !== undefined ? { adminNotes: notas } : {}),
        ...(final ? { resolvedBy: req.adminId!, resolvedAt: new Date(), acaoRetirou: retirou, acaoSuspendeu: suspendeu } : {}),
      }).where(eq(reportsTable.id, id)).returning();

      // Mensagem retirada AUTOMATICAMENTE por esta denúncia (menor) e agora improcedente: repõe-se sozinha, com auditoria, salvo se algo o impedir
      // (outra denúncia aberta/procedente sobre a mesma mensagem, caso de menor). Os outros tipos não têm esta reposição automática.
      if (novo === "improcedente" && r.targetType === "mensagem" && await retiradaAutoDestaDenuncia(tx, id, r.targetId)) {
        const est = await estadoRetiradaMensagem(tx, { id, targetId: r.targetId, status: novo });
        if (est.podeRepor) {
          await reporMensagem(tx, { reportId: id, mensagemId: r.targetId, reportStatus: novo, adminId: req.adminId!, ip: req.ip ?? null, motivo: "Denúncia improcedente.", automatica: true });
          reposicao = { feita: true, impedimento: null };
        } else if (est.retirada) {
          reposicao = { feita: false, impedimento: est.impedimento };
        }
      }

      // Auditoria dentro da transação: se falhar, reverte decisão, retirada, suspensão e notificações
      await tx.insert(auditLogTable).values({
        adminId: req.adminId!,
        action: `report_${novo}`,
        targetType: "report",
        targetId: id,
        details: { before: { status: r.status }, after: { status: novo }, acoes: { retirou, suspendeu, avisarAutor: acoes.avisarAutor, avisarDenunciante: acoes.avisarDenunciante, marcarMais18: infracaoAudit }, alvo: { tipo: r.targetType, id: r.targetId } },
        ipAddress: req.ip ?? null,
      });
      return u;
    });

    if (marcacaoMais18) efeitosAposCommit(marcacaoMais18, true); // sockets: criadora suspensa / espectadores de uma live +18
    const { reporterIp: _ip, reporterContact: _c, ...seguro } = updated;
    const rp = reposicao as { feita: boolean; impedimento: string | null } | null; // atribuído dentro da transação
    res.json(rp ? { ...seguro, mensagemReposta: rp.feita, reposicaoImpedida: rp.impedimento } : seguro);
  } catch (err) {
    if (err instanceof TakedownError) return void res.status(err.httpStatus).json({ error: err.message });
    (req as any).log?.error({ err }, "Erro ao resolver denúncia");
    res.status(500).json({ error: "Erro interno." });
  }
});

// Repor a mensagem denunciada (só tipo mensagem, só com a denúncia já decidida). Não é um PATCH porque a denúncia mantém o estado decidido
// (procedente/improcedente são finais). Exige motivo. A retirada/reposição de mensagens nunca é direta: passa sempre por uma denúncia.
router.post("/admin/reports/:id/repor", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return void res.status(400).json({ error: "ID inválido" });
    const motivo = typeof req.body?.motivo === "string" ? req.body.motivo.trim() : "";
    if (motivo.length < 5) return void res.status(400).json({ error: "Indica o motivo da reposição (mínimo 5 caracteres)." });
    if (motivo.length > 300) return void res.status(400).json({ error: "O motivo da reposição tem no máximo 300 caracteres." });

    const out = await db.transaction(async (tx) => {
      const [r] = await tx.select().from(reportsTable).where(eq(reportsTable.id, id)).for("update");
      if (!r) throw new TakedownError("Denúncia não encontrada", 404);
      if (r.targetType !== "mensagem") throw new TakedownError("Só se repõe por aqui uma denúncia de mensagem.", 400);
      return reporMensagem(tx, { reportId: id, mensagemId: r.targetId, reportStatus: r.status, adminId: req.adminId!, ip: req.ip ?? null, motivo, automatica: false });
    });
    res.json({ ok: true, reposta: true, anterior: { retiradaEm: out.retiradaEm, retiradoPor: out.retiradoPor, retiradoMotivo: out.retiradoMotivo, retiradaAuto: out.retiradaAuto } });
  } catch (err) {
    if (err instanceof TakedownError) return void res.status(err.httpStatus).json({ error: err.message });
    (req as any).log?.error({ err }, "Erro ao repor mensagem");
    res.status(500).json({ error: "Erro interno." });
  }
});

// ── Retirada direta de conteúdo (sem denúncia): retirar / repor / apagar ficheiros ─────────────────────
function parseAlvoParams(req: AdminRequest): { type: TargetType; id: number } | null {
  const type = req.params.type as TargetType;
  const id = Number(req.params.id);
  // A mensagem só se retira/repõe por uma denúncia (PATCH /admin/reports/:id): nunca diretamente, para o admin não aceder a conversas sem denúncia
  if (!TARGET_TYPES.includes(type) || type === "mensagem" || !Number.isInteger(id) || id <= 0) return null;
  return { type, id };
}

router.post("/admin/content/:type/:id/retirar", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const p = parseAlvoParams(req);
  if (!p) return void res.status(400).json({ error: "Tipo ou ID inválido" });
  try {
    const motivo = (typeof req.body?.motivo === "string" ? req.body.motivo.trim() : "").slice(0, 300) || "Violação das regras da plataforma.";
    const avisar = req.body?.avisarAutor !== false;
    const r = await db.transaction(async (tx) => {
      const alvo = await lerAlvo(tx, p.type, p.id);
      if (!alvo) throw new TakedownError("Conteúdo não encontrado", 404);
      const out = await retirarAlvo(tx, p.type, p.id, req.adminId!, motivo);
      if (out.mudou) {
        await tx.insert(auditLogTable).values({
          adminId: req.adminId!, action: "conteudo_retirado", targetType: p.type, targetId: p.id,
          details: { motivo }, ipAddress: req.ip ?? null,
        });
        if (avisar) {
          await notificarSistema(tx, alvo.ownerId, p.type === "user"
            ? `A tua conta foi suspensa por violação das regras da plataforma. Motivo: ${motivo}`
            : `O teu ${TARGET_LABEL[p.type]} foi retirado por violar as regras da plataforma. Motivo: ${motivo}`);
        }
      }
      return out;
    });
    res.json({ ok: true, retirado: r.mudou });
  } catch (err) {
    if (err instanceof TakedownError) return void res.status(err.httpStatus).json({ error: err.message });
    (req as any).log?.error({ err }, "Erro ao retirar conteúdo");
    res.status(500).json({ error: "Erro interno." });
  }
});

router.post("/admin/content/:type/:id/repor", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const p = parseAlvoParams(req);
  if (!p) return void res.status(400).json({ error: "Tipo ou ID inválido" });
  try {
    const r = await db.transaction(async (tx) => {
      const alvo = await lerAlvo(tx, p.type, p.id);
      if (!alvo) throw new TakedownError("Conteúdo não encontrado", 404);
      const out = await restaurarAlvo(tx, p.type, p.id);
      await tx.insert(auditLogTable).values({
        adminId: req.adminId!, action: "conteudo_restaurado", targetType: p.type, targetId: p.id,
        details: { motivo: typeof req.body?.motivo === "string" ? req.body.motivo.slice(0, 300) : null }, ipAddress: req.ip ?? null,
      });
      return out;
    });
    res.json({ ok: true, reposto: r.mudou });
  } catch (err) {
    if (err instanceof TakedownError) return void res.status(err.httpStatus).json({ error: err.message });
    (req as any).log?.error({ err }, "Erro ao repor conteúdo");
    res.status(500).json({ error: "Erro interno." });
  }
});

// Marcar / desmarcar conteúdo como +18 (post, story, live). Corpo: { mais18: boolean, infracao?: boolean, motivo? }.
//   mais18:true + infracao:true  → "a criadora não marcou": regista infração (1.ª/2.ª aviso, n>=3 suspensão), tudo numa transação.
//   mais18:true + infracao:false → correção do admin: só marca (audit); sem infração nem notificação.
//   mais18:false                 → desmarca (a infração ativa, se existir, anula-se em separado).
// `infracao` é obrigatório ao marcar (sem valor por omissão: o admin tem de escolher).
router.post("/admin/content/:type/:id/mais18", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const p = parseAlvoParams(req);
  if (!p || !isTipoMais18(p.type)) return void res.status(400).json({ error: "Tipo ou ID inválido (post, story ou live)" });
  const { mais18, infracao, motivo } = (req.body ?? {}) as { mais18?: unknown; infracao?: unknown; motivo?: unknown };
  if (typeof mais18 !== "boolean") return void res.status(400).json({ error: "mais18 é obrigatório (verdadeiro ou falso)." });
  if (mais18 && typeof infracao !== "boolean") return void res.status(400).json({ error: "infracao é obrigatório ao marcar (true = a criadora não marcou; false = correção)." });
  if (!mais18 && infracao === true) return void res.status(400).json({ error: "Desmarcar não regista infração." });
  if (motivo !== undefined && typeof motivo !== "string") return void res.status(400).json({ error: "motivo inválido." });
  try {
    const tipo = p.type;
    const r = await db.transaction((tx) => marcarMais18PorAdmin(tx, {
      adminId: req.adminId!, ip: req.ip ?? null, tipo, conteudoId: p.id, mais18, infracao: infracao === true, motivo: (motivo as string | undefined)?.trim() || null,
    }));
    efeitosAposCommit(r, mais18);
    res.json({
      ok: true, mudou: r.mudou, infracao: r.infracao, semInfracaoPorque: r.semInfracaoPorque, suspendeu: r.suspendeu, infracaoAtivaId: r.infracaoAtivaId,
    });
  } catch (err) {
    if (err instanceof TakedownError) return void res.status(err.httpStatus).json({ error: err.message });
    (req as any).log?.error({ err: err instanceof Error ? err.name : "erro" }, "Erro ao marcar conteúdo +18");
    res.status(500).json({ error: "Erro interno." });
  }
});

// Anular uma infração +18 (fica registada com quem/quando/porquê e deixa de contar). Não reativa a conta.
router.post("/admin/infracoes/:id/anular", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return void res.status(400).json({ error: "ID inválido" });
  const motivo = typeof req.body?.motivo === "string" ? req.body.motivo.trim() : "";
  if (!motivo) return void res.status(400).json({ error: "O motivo da anulação é obrigatório." });
  try {
    const r = await db.transaction((tx) => anularInfracao(tx, { adminId: req.adminId!, ip: req.ip ?? null, infracaoId: id, motivo }));
    res.json({ ok: true, ativas: r.ativasDepois });
  } catch (err) {
    if (err instanceof TakedownError) return void res.status(err.httpStatus).json({ error: err.message });
    (req as any).log?.error({ err: err instanceof Error ? err.name : "erro" }, "Erro ao anular infração");
    res.status(500).json({ error: "Erro interno." });
  }
});

// Infrações +18 de uma criadora (ativas e anuladas) e a contagem que vale para as sanções.
router.get("/admin/users/:id/infracoes", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return void res.status(400).json({ error: "ID inválido" });
  try {
    const [u] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!u) return void res.status(404).json({ error: "Utilizador não encontrado" });
    const rows = await db.select().from(infracoesMais18Table).where(eq(infracoesMais18Table.userId, id)).orderBy(desc(infracoesMais18Table.criadaEm), desc(infracoesMais18Table.id));
    res.json({
      ativas: await contarInfracoesAtivas(db, id),
      total: rows.length,
      infracoes: rows.map((i) => ({
        id: i.id, tipoConteudo: i.tipoConteudo, conteudoId: i.conteudoId, origem: i.origem, numero: i.numero, acao: i.acao,
        adminId: i.adminId, reportId: i.reportId, motivo: i.motivo, criadaEm: i.criadaEm,
        anulada: i.anuladaEm ? { em: i.anuladaEm, por: i.anuladaPor, motivo: i.anuladaMotivo } : null,
      })),
    });
  } catch (err) {
    (req as any).log?.error({ err: err instanceof Error ? err.name : "erro" }, "Erro ao listar infrações");
    res.status(500).json({ error: "Erro interno." });
  }
});

// DESATIVADO: eliminar só os ficheiros de conteúdo retirado destruía a prova. O conteúdo retirado fica retido;
// para apagar de vez, a denúncia tem de estar decidida e o conteúdo é eliminado por inteiro (com motivo): DELETE /admin/posts/:id.
router.delete("/admin/content/:type/:id/ficheiros", requireAdmin, (_req: AdminRequest, res): void => {
  res.status(409).json({ error: "Eliminar apenas os ficheiros está desativado: o conteúdo retirado fica retido como prova. Para o apagar de vez, a denúncia tem de estar decidida e arquivada, e o conteúdo é eliminado por inteiro, com motivo." });
});

// ────────────────────────────────────────────────────────────────────────────
// FINANCE
// ────────────────────────────────────────────────────────────────────────────

router.get("/admin/finance/kpis", async (req, res) => {
  try {
    const inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);

    const [
      [{ receitaTotal, comissaoTotal }],
      [{ receitaMes }],
      [{ totalTransacoes }],
    ] = await Promise.all([
      db.select({
        receitaTotal: sum(purchasesTable.valor),
        comissaoTotal: sum(purchasesTable.comissao)
      }).from(purchasesTable),
      db.select({ receitaMes: sum(purchasesTable.valor) }).from(purchasesTable)
        .where(gte(purchasesTable.criadoEm, inicioMes)),
      db.select({ totalTransacoes: count() }).from(purchasesTable),
    ]);

    const total = Number(receitaTotal ?? 0);
    const comissao = Number(comissaoTotal ?? 0);
    const mes = Number(receitaMes ?? 0);
    const txCount = Number(totalTransacoes);

    res.json({
      receitaTotal: total,
      comissaoRetida: comissao,
      pagoCriadores: total - comissao,
      ticketMedio: txCount > 0 ? Math.round(total / txCount) : 0,
      receitaMes: mes,
      crescimentoMes: 0, // requereria dados do mês anterior
    });
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao obter KPIs financeiros");
    res.status(500).json({ error: "Erro interno." });
  }
});

router.get("/admin/finance/transactions", async (req, res) => {
  try {
    const { page = "1", limit = "10", tipo } = req.query as Record<string, string>;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions: any[] = [];
    if (tipo) conditions.push(eq(purchasesTable.tipo, tipo as any));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const compradorAlias = sql`pagador`;
    const vendedorAlias = sql`recetor`;

    const [rows, [{ total }]] = await Promise.all([
      db.select({
        id: purchasesTable.id,
        tipo: purchasesTable.tipo,
        valor: purchasesTable.valor,
        comissao: purchasesTable.comissao,
        compradorId: purchasesTable.compradorId,
        vendedorId: purchasesTable.vendedorId,
        descricao: purchasesTable.descricao,
        criadoEm: purchasesTable.criadoEm,
      })
        .from(purchasesTable)
        .where(where)
        .orderBy(desc(purchasesTable.criadoEm))
        .limit(limitNum)
        .offset(offset),
      db.select({ total: count() }).from(purchasesTable).where(where),
    ]);

    res.json(paginate(
      rows.map(r => ({ ...r, valor: Number(r.valor), comissao: Number(r.comissao ?? 0) })),
      Number(total), pageNum, limitNum
    ));
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao listar transacções");
    res.status(500).json({ error: "Erro interno." });
  }
});

router.get("/admin/finance/transactions/export", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(purchasesTable)
      .orderBy(desc(purchasesTable.criadoEm))
      .limit(10000);

    const headers = ["id", "tipo", "valor", "compradorId", "vendedorId", "descricao", "criadoEm"];
    const csvRows = rows.map(r =>
      [r.id, r.tipo, r.valor, r.compradorId, r.vendedorId, r.descricao ?? "", r.criadoEm.toISOString()].join(",")
    );
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=transacoes.csv");
    res.send([headers.join(","), ...csvRows].join("\n"));
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao exportar transacções");
    res.status(500).json({ error: "Erro interno." });
  }
});

const WITHDRAWAL_STATUSES = ["pendente", "aprovado", "rejeitado", "pago", "retido"] as const;
type WithdrawalStatus = typeof WITHDRAWAL_STATUSES[number];
/**
 * Máquina de estados rígida: pendente→aprovado→pago; pendente→rejeitado; pago e rejeitado são finais.
 * Retenção (Termos para Criadoras, Art. 6.º): pendente|aprovado→retido→aprovado (libertar) | rejeitado. O retido não vai a pago
 * nem volta a pendente; os ganhos ficam reservados enquanto está retido e só voltam na rejeição (uma vez).
 */
const WITHDRAWAL_TRANSITIONS: Record<WithdrawalStatus, WithdrawalStatus[]> = {
  pendente: ["aprovado", "rejeitado", "retido"],
  aprovado: ["pago", "retido"],
  retido: ["aprovado", "rejeitado"],
  rejeitado: [],
  pago: [],
};

class WithdrawalHttpError extends Error {
  constructor(msg: string, public readonly httpStatus: number) {
    super(msg);
  }
}

router.get("/admin/withdrawals", async (req, res) => {
  try {
    const { page = "1", limit = "10", status } = req.query as Record<string, string>;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const offset = (pageNum - 1) * limitNum;

    if (status && !WITHDRAWAL_STATUSES.includes(status as WithdrawalStatus)) {
      return void res.status(400).json({ error: `Estado inválido. Valores permitidos: ${WITHDRAWAL_STATUSES.join(", ")}` });
    }
    const conditions: any[] = [];
    if (status) conditions.push(eq(withdrawalRequestsTable.status, status as WithdrawalStatus));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      db.select({
        id: withdrawalRequestsTable.id,
        creatorId: withdrawalRequestsTable.creatorId,
        creatorUsername: usersTable.username,
        amount: withdrawalRequestsTable.amount,
        method: withdrawalRequestsTable.method,
        status: withdrawalRequestsTable.status,
        processedBy: withdrawalRequestsTable.processedBy,
        processedAt: withdrawalRequestsTable.processedAt,
        notes: withdrawalRequestsTable.notes,
        criadoEm: withdrawalRequestsTable.criadoEm,
        retidoEm: withdrawalRequestsTable.retidoEm,
        retidoMotivo: withdrawalRequestsTable.retidoMotivo,
        retidoMotivoVisivel: withdrawalRequestsTable.retidoMotivoVisivel,
        creatorBanidaEm: usersTable.banidaEm,
        // destinationDetails (IBAN) NUNCA em listagens: só no detalhe, com audit_log.
      })
        .from(withdrawalRequestsTable)
        .leftJoin(usersTable, eq(withdrawalRequestsTable.creatorId, usersTable.id))
        .where(where)
        .orderBy(desc(withdrawalRequestsTable.criadoEm))
        .limit(limitNum)
        .offset(offset),
      db.select({ total: count() }).from(withdrawalRequestsTable).where(where),
    ]);

    res.json(paginate(
      rows.map(({ creatorBanidaEm, ...r }) => ({ ...r, amount: Number(r.amount), creatorBanida: creatorBanidaEm !== null })),
      Number(total), pageNum, limitNum
    ));
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao listar levantamentos");
    res.status(500).json({ error: "Erro interno." });
  }
});

// Detalhe de um pedido, com os dados de pagamento. Cada visualização grava audit_log NA MESMA transação:
// se o registo falhar, o IBAN não é devolvido.
router.get("/admin/withdrawals/:id", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return void res.status(400).json({ error: "ID inválido" });

    const row = await db.transaction(async (tx) => {
      const [w] = await tx.select().from(withdrawalRequestsTable).where(eq(withdrawalRequestsTable.id, id)).limit(1);
      if (!w) throw new WithdrawalHttpError("Pedido não encontrado", 404);
      await tx.insert(auditLogTable).values({
        adminId: req.adminId!,
        action: "withdrawal_dados_vistos",
        targetType: "withdrawal",
        targetId: id,
        details: { creatorId: w.creatorId },
        ipAddress: req.ip ?? null,
      });
      return w;
    });

    res.set("Cache-Control", "no-store");
    res.json({ ...row, amount: Number(row.amount) });
  } catch (err) {
    if (err instanceof WithdrawalHttpError) return void res.status(err.httpStatus).json({ error: err.message });
    (req as any).log?.error({ err }, "Erro ao obter levantamento");
    res.status(500).json({ error: "Erro interno." });
  }
});

router.patch("/admin/withdrawals/:id", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return void res.status(400).json({ error: "ID inválido" });

    const novo = req.body?.status;
    if (!WITHDRAWAL_STATUSES.includes(novo)) {
      return void res.status(400).json({ error: `Estado inválido. Valores permitidos: ${WITHDRAWAL_STATUSES.join(", ")}` });
    }
    const notes = typeof req.body.notes === "string" ? req.body.notes.slice(0, 500) : undefined;

    // Retenção: motivo obrigatório (10 a 500 caracteres, validado AQUI e depois do trim) antes de abrir a transação.
    const motivoRetencao = typeof req.body.motivo === "string" ? req.body.motivo.trim() : "";
    const ocultarMotivo = req.body.ocultarMotivo === true;
    if (novo === "retido" && (motivoRetencao.length < 10 || motivoRetencao.length > 500)) {
      return void res.status(400).json({ error: "Indica o motivo da retenção (entre 10 e 500 caracteres)." });
    }

    const updated = await db.transaction(async (tx) => {
      const [peek] = await tx.select({ creatorId: withdrawalRequestsTable.creatorId }).from(withdrawalRequestsTable)
        .where(eq(withdrawalRequestsTable.id, id)).limit(1);
      if (!peek) throw new WithdrawalHttpError("Pedido não encontrado", 404);

      // Ordem de locks igual à do pedido da criadora (utilizador → pedido): sem deadlocks.
      await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, peek.creatorId)).for("update");
      const [w] = await tx.select().from(withdrawalRequestsTable).where(eq(withdrawalRequestsTable.id, id)).for("update");
      if (!w) throw new WithdrawalHttpError("Pedido não encontrado", 404);

      // O estado é lido DEPOIS do lock: dois PATCH em simultâneo não passam ambos.
      if (!WITHDRAWAL_TRANSITIONS[w.status].includes(novo)) {
        throw new WithdrawalHttpError(`Transição inválida: ${w.status} → ${novo}`, 409);
      }

      // Rejeição: devolve a reserva UMA vez (só se transita de pendente). Aprovar/pagar não mexem em ganhos.
      if (novo === "rejeitado") {
        await tx.update(usersTable).set({ ganhos: sql`${usersTable.ganhos} + ${Number(w.amount)}` }).where(eq(usersTable.id, w.creatorId));
      }

      const [u] = await tx.update(withdrawalRequestsTable)
        .set({
          status: novo, processedBy: req.adminId ?? undefined, processedAt: new Date(), ...(notes !== undefined ? { notes } : {}),
          ...(novo === "retido" ? { retidoEm: new Date(), retidoPor: req.adminId ?? null, retidoMotivo: motivoRetencao, retidoMotivoVisivel: !ocultarMotivo } : {}),
        })
        .where(eq(withdrawalRequestsTable.id, id)).returning();

      // Retenção e libertação: notificam a criadora NA MESMA transação (sem IBAN; o motivo só se não estiver escondido).
      // Se a notificação falhar, reverte tudo (estado, auditoria).
      if (novo === "retido") {
        const valor = Number(w.amount).toLocaleString("pt-PT");
        const base = `O teu pedido de levantamento de ${valor} Kz foi retido ao abrigo do Artigo 6.º dos Termos para Criadoras.`;
        await notificarSistema(tx, w.creatorId, ocultarMotivo
          ? `${base} Para mais informações contacta ${emailLegal()}.`
          : `${base} Motivo: ${motivoRetencao.replace(/[.\s]+$/, "")}.`);
      } else if (w.status === "retido" && novo === "aprovado") {
        await notificarSistema(tx, w.creatorId, `O teu levantamento de ${Number(w.amount).toLocaleString("pt-PT")} Kz foi libertado e segue para pagamento.`);
      }

      // Rejeição: notifica a criadora NA MESMA transação (motivo, sem IBAN nem dados bancários).
      // Se a notificação falhar, reverte tudo (estado, reembolso e auditoria).
      if (novo === "rejeitado") {
        const motivo = (u.notes ?? "").trim();
        await tx.insert(notificationsTable).values({
          destinatarioId: w.creatorId,
          tipo: "sistema",
          alvoId: id,
          mensagem: `O teu pedido de levantamento de ${Number(w.amount).toLocaleString("pt-PT")} Kz foi rejeitado.${motivo ? ` Motivo: ${motivo}.` : ""} Os ganhos voltaram à tua conta.`,
        });
      }

      // Auditoria dentro da transação: se falhar, reverte estado e reembolso.
      await tx.insert(auditLogTable).values({
        adminId: req.adminId!,
        action: `withdrawal_${novo}`,
        targetType: "withdrawal",
        targetId: id,
        details: {
          before: { status: w.status }, after: { status: novo, notes: u.notes }, amount: Number(w.amount), reembolso: novo === "rejeitado",
          ...(novo === "retido" ? { retencao: { motivo: motivoRetencao, motivoVisivel: !ocultarMotivo } } : {}),
        },
        ipAddress: req.ip ?? null,
      });
      return u;
    });

    // Remover destinationDetails (IBAN) da resposta
    const { destinationDetails: _stripped, ...safeWithdrawal } = updated as any;
    res.json({ ...safeWithdrawal, amount: Number(safeWithdrawal.amount) });
  } catch (err) {
    if (err instanceof WithdrawalHttpError) return void res.status(err.httpStatus).json({ error: err.message });
    (req as any).log?.error({ err }, "Erro ao processar levantamento");
    res.status(500).json({ error: "Erro interno." });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// TOP-UPS
// ────────────────────────────────────────────────────────────────────────────

/**
 * Lista pedidos de carregamento da base de dados real.
 *
 * O estado interno dos top-ups usa os valores portugueses "pendente",
 * "aprovado" e "rejeitado" (ao contrário dos levantamentos, que usam
 * pending/approved/rejected). Quando não é enviado filtro, devolvemos todos
 * os estados para que nenhum pedido fique invisível por omissão.
 */
router.get("/admin/topups", async (req, res) => {
  try {
    const { page = "1", limit = "20", status } = req.query as Record<string, string>;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const offset = (pageNum - 1) * limitNum;

    const estadosValidos = ["pendente", "aprovado", "rejeitado"];
    const conditions: any[] = [];
    if (status && estadosValidos.includes(status)) {
      conditions.push(eq(topupRequestsTable.status, status));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      db.select({
        id: topupRequestsTable.id,
        userId: topupRequestsTable.userId,
        username: usersTable.username,
        nomeCompleto: usersTable.nomeExibicao,
        amount: topupRequestsTable.amount,
        reference: topupRequestsTable.reference,
        status: topupRequestsTable.status,
        comprovantivoBase64: topupRequestsTable.comprovantivoBase64,
        comprovantivoNome: topupRequestsTable.comprovantivoNome,
        processadoPor: topupRequestsTable.processadoPor,
        processadoEm: topupRequestsTable.processadoEm,
        notas: topupRequestsTable.notas,
        criadoEm: topupRequestsTable.criadoEm,
      })
        .from(topupRequestsTable)
        .innerJoin(usersTable, eq(topupRequestsTable.userId, usersTable.id))
        .where(where)
        .orderBy(desc(topupRequestsTable.criadoEm))
        .limit(limitNum)
        .offset(offset),
      db.select({ total: count() }).from(topupRequestsTable).where(where),
    ]);

    res.json(paginate(
      rows.map((row) => ({
        ...row,
        amount: Number(row.amount),
        processadoEm: row.processadoEm?.toISOString() ?? null,
        criadoEm: row.criadoEm.toISOString(),
        adminNota: row.notas,
      })),
      Number(total),
      pageNum,
      limitNum,
    ));
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao listar carregamentos");
    res.status(500).json({ error: "Erro interno." });
  }
});

/**
 * Aprova ou rejeita um pedido. A aprovação credita o saldo uma única vez:
 * a transacção actualiza apenas pedidos ainda pendentes e só depois credita
 * o utilizador, evitando crédito duplicado em cliques concorrentes.
 */
router.patch("/admin/topups/:id", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = Number(req.params.id);
  const status = req.body?.status;
  const notas = typeof req.body?.notas === "string" ? req.body.notas.trim() : undefined;

  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "ID inválido." });
    return;
  }
  if (status !== "aprovado" && status !== "rejeitado") {
    res.status(400).json({ error: "Estado inválido. Use 'aprovado' ou 'rejeitado'." });
    return;
  }

  try {
    const updated = await db.transaction(async (tx) => {
      const [request] = await tx
        .update(topupRequestsTable)
        .set({
          status,
          processadoPor: req.adminId!,
          processadoEm: new Date(),
          ...(notas !== undefined ? { notas: notas || null } : {}),
        })
        .where(and(
          eq(topupRequestsTable.id, id),
          eq(topupRequestsTable.status, "pendente"),
        ))
        .returning();

      if (!request) return null;

      if (status === "aprovado") {
        await tx
          .update(usersTable)
          .set({ saldo: sql`${usersTable.saldo} + ${request.amount}` })
          .where(eq(usersTable.id, request.userId));
      }

      return request;
    });

    if (!updated) {
      res.status(409).json({ error: "Este pedido já foi processado ou não existe." });
      return;
    }

    await logAudit(req, status === "aprovado" ? "topup_approved" : "topup_rejected", "topup", id, {
      amount: Number(updated.amount),
      userId: updated.userId,
      reference: updated.reference,
      notas: notas ?? null,
    });

    res.json({
      id: updated.id,
      userId: updated.userId,
      amount: Number(updated.amount),
      reference: updated.reference,
      status: updated.status,
      processadoPor: updated.processadoPor,
      processadoEm: updated.processadoEm?.toISOString() ?? null,
      notas: updated.notas,
      criadoEm: updated.criadoEm.toISOString(),
    });
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao processar carregamento");
    res.status(500).json({ error: "Erro ao processar pedido de carregamento." });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// BROADCAST
// ────────────────────────────────────────────────────────────────────────────

router.post("/admin/broadcast", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  try {
    const { titulo, mensagem, segmento } = req.body;
    if (!titulo || !mensagem) {
      return void res.status(400).json({ error: "titulo e mensagem são obrigatórios." });
    }

    const conditions: any[] = [eq(usersTable.ativo, true), notInArray(usersTable.role, ['admin', 'superadmin'])];
    if (segmento === "creators" || segmento === "criadores") {
      conditions.push(eq(usersTable.tipoConta, "criador"));
    } else if (segmento === "users" || segmento === "fans") {
      conditions.push(eq(usersTable.tipoConta, "pessoal"));
    } else if (segmento === "inactive") {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      conditions.push(sql`${usersTable.criadoEm} <= ${thirtyDaysAgo}`); // Approximation, as we don't track last login.
    }

    const targetUsers = await db.select({ id: usersTable.id }).from(usersTable).where(and(...conditions));
    
    let totalCriadas = 0;
    if (targetUsers.length > 0) {
      // Drizzle ORM supports batch inserts seamlessly via array
      const notificationsData = targetUsers.map(user => ({
        destinatarioId: user.id,
        tipo: "sistema" as const,
        atorId: req.adminId, // The admin is the sender
        mensagem: mensagem.substring(0, 255), // safety limit
      }));

      // Insert in chunks of 500 to avoid query size limits on huge DBs
      const chunkSize = 500;
      for (let i = 0; i < notificationsData.length; i += chunkSize) {
        const chunk = notificationsData.slice(i, i + chunkSize);
        await db.insert(notificationsTable).values(chunk);
      }
      totalCriadas = targetUsers.length;
    }

    // Guardar o broadcast no audit_log como registo
    await logAudit(req, "broadcast_send", "platform", null, {
      titulo,
      mensagem,
      segmento: segmento ?? "todos",
      totalEntregas: totalCriadas,
    });

    res.status(201).json({
      success: true,
      titulo,
      mensagem,
      segmento: segmento ?? "todos",
      totalEntregas: totalCriadas,
      criadoEm: new Date().toISOString(),
    });
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao enviar broadcast");
    res.status(500).json({ error: "Erro interno." });
  }
});

router.get("/admin/broadcast/history", async (req, res) => {
  try {
    // Broadcasts registados no audit_log
    const rows = await db
      .select({
        id: auditLogTable.id,
        details: auditLogTable.details,
        criadoEm: auditLogTable.criadoEm,
        adminUsername: usersTable.username,
      })
      .from(auditLogTable)
      .leftJoin(usersTable, eq(auditLogTable.adminId, usersTable.id))
      .where(eq(auditLogTable.action, "broadcast_send"))
      .orderBy(desc(auditLogTable.criadoEm))
      .limit(50);

    res.json(rows.map(r => ({
      id: r.id,
      titulo: (r.details as any)?.titulo ?? "",
      mensagem: (r.details as any)?.mensagem ?? "",
      segmento: (r.details as any)?.segmento ?? "todos",
      enviadoPor: r.adminUsername,
      criadoEm: r.criadoEm,
    })));
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao obter histórico de broadcasts");
    res.status(500).json({ error: "Erro interno." });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// SETTINGS
// ────────────────────────────────────────────────────────────────────────────

// Defaults aplicados quando a tabela está vazia. A comissão NÃO tem default: vem sempre da base de dados.
const DEFAULT_SETTINGS: Record<string, unknown> = {
  maintenance_mode: { enabled: false },
  [REGISTOS_KEY]: { value: true }, // registos abertos por omissão
  allowed_countries: { list: ["AO", "MZ", "ZA", "PT", "BR"] },
  min_withdrawal_amount: { value: 5000 },
};

router.get("/admin/settings", async (req, res) => {
  try {
    const rows = await db.select().from(platformSettingsTable);
    const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS, [COMMISSION_KEY]: null }; // null = não definida
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    res.json(settings);
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao obter definições");
    res.status(500).json({ error: "Erro interno." });
  }
});

router.patch("/admin/settings", requireAdmin, async (req: AdminRequest, res): Promise<void> => {

  try {
    const erros: string[] = [];
    const updates: Array<{ key: string; value: unknown }> = [];

    if (req.body.commission_rate !== undefined) {
      // Tem de ser { value: <NÚMERO 0-100> }: null, string, array, booleano ou objeto vazio são recusados,
      // e a taxa nunca pode ser apagada.
      const cr = req.body.commission_rate;
      const v = cr !== null && typeof cr === "object" && !Array.isArray(cr) ? (cr as { value?: unknown }).value : undefined;
      if (!taxaValida(v) || !taxaComDuasCasas(v)) erros.push("commission_rate.value deve ser um número entre 0 e 100 (no máximo 2 casas decimais)");
      else updates.push({ key: COMMISSION_KEY, value: { value: v } });
    }
    if (req.body.maintenance_mode !== undefined) {
      if (typeof req.body.maintenance_mode?.enabled !== "boolean") erros.push("maintenance_mode.enabled deve ser boolean");
      else updates.push({ key: "maintenance_mode", value: { enabled: req.body.maintenance_mode.enabled } });
    }
    if (req.body.registos_abertos !== undefined) {
      // Estritamente boolean: null, string, número, array ou objeto vazio são recusados.
      const v = req.body.registos_abertos?.value;
      if (typeof v !== "boolean") erros.push("registos_abertos.value deve ser boolean");
      else updates.push({ key: REGISTOS_KEY, value: { value: v } });
    }
    if (req.body.allowed_countries !== undefined) {
      const list = req.body.allowed_countries?.list;
      if (!Array.isArray(list) || list.some((c: unknown) => typeof c !== "string" || c.length > 5)) {
        erros.push("allowed_countries.list deve ser um array de códigos de país");
      } else {
        updates.push({ key: "allowed_countries", value: { list } });
      }
    }
    if (req.body.min_withdrawal_amount !== undefined) {
      const val = Number(req.body.min_withdrawal_amount?.value);
      if (!Number.isFinite(val) || val < 0) erros.push("min_withdrawal_amount.value deve ser um número positivo");
      else updates.push({ key: "min_withdrawal_amount", value: { value: val } });
    }

    if (erros.length > 0) return void res.status(400).json({ error: "Dados inválidos", details: erros });

    const beforeRows = await db.select().from(platformSettingsTable);
    const before: Record<string, unknown> = {};
    for (const r of beforeRows) before[r.key] = r.value;

    // Upserts e audit na MESMA transação: se o audit falhar, nada é alterado.
    await db.transaction(async (tx) => {
      // Taxa anterior lida com lock, para o audit registar exatamente o que foi substituído.
      const [antes] = await tx.select({ value: platformSettingsTable.value }).from(platformSettingsTable)
        .where(eq(platformSettingsTable.key, COMMISSION_KEY)).for("update").limit(1);
      const taxaAnterior = (antes?.value as { value?: unknown } | undefined)?.value;
      // Estado anterior dos registos, lido com lock (ausente = aberto), para o audit e para a releitura FOR SHARE do registo.
      // Garante que a linha existe (aberta) antes do lock, para a primeira alteração também ficar protegida de registos em curso.
      if (updates.some((u) => u.key === REGISTOS_KEY)) {
        await tx.insert(platformSettingsTable)
          .values({ key: REGISTOS_KEY, value: { value: true } as any, updatedBy: req.adminId ?? undefined })
          .onConflictDoNothing();
      }
      const [antesReg] = await tx.select({ value: platformSettingsTable.value }).from(platformSettingsTable)
        .where(eq(platformSettingsTable.key, REGISTOS_KEY)).for("update").limit(1);
      const registosAnterior = registosAbertosDe(antesReg?.value);

      for (const upd of updates) {
        await tx.insert(platformSettingsTable)
          .values({ key: upd.key, value: upd.value as any, updatedBy: req.adminId ?? undefined })
          .onConflictDoUpdate({
            target: platformSettingsTable.key,
            set: { value: upd.value as any, updatedBy: req.adminId ?? undefined, updatedAt: new Date() },
          });
      }

      const novaTaxa = updates.find((u) => u.key === COMMISSION_KEY);
      if (novaTaxa) {
        await tx.insert(auditLogTable).values({
          adminId: req.adminId!, action: "commission_rate_update", targetType: "platform", targetId: 0,
          details: { anterior: taxaValida(taxaAnterior) ? taxaAnterior : null, novo: (novaTaxa.value as { value: number }).value },
          ipAddress: req.ip ?? null,
        });
      }
      const novoReg = updates.find((u) => u.key === REGISTOS_KEY);
      if (novoReg) {
        const novo = (novoReg.value as { value: boolean }).value;
        if (novo !== registosAnterior) { // só se mudou
          await tx.insert(auditLogTable).values({
            adminId: req.adminId!, action: "registos_update", targetType: "platform", targetId: 0,
            details: { anterior: registosAnterior, novo }, ipAddress: req.ip ?? null,
          });
        }
      }
      const outras = updates.filter((u) => u.key !== COMMISSION_KEY && u.key !== REGISTOS_KEY);
      if (outras.length > 0) {
        await tx.insert(auditLogTable).values({
          adminId: req.adminId!, action: "settings_update", targetType: "platform", targetId: 0,
          details: { before, after: Object.fromEntries(outras.map((u) => [u.key, u.value])) },
          ipAddress: req.ip ?? null,
        });
      }
    });

    const afterRows = await db.select().from(platformSettingsTable);
    const after: Record<string, unknown> = { ...DEFAULT_SETTINGS, [COMMISSION_KEY]: null };
    for (const r of afterRows) after[r.key] = r.value;

    res.json(after);
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao actualizar definições");
    res.status(500).json({ error: "Erro interno." });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// AUDIT LOG
// ────────────────────────────────────────────────────────────────────────────

router.get("/admin/audit-log", async (req, res) => {
  const { page = "1", limit = "10", adminId, action } = req.query as Record<string, string>;
  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.min(100, Math.max(1, Number(limit)));
  const offset = (pageNum - 1) * limitNum;

  try {
    const conditions = [];
    if (adminId) conditions.push(eq(auditLogTable.adminId, Number(adminId)));
    if (action) conditions.push(eq(auditLogTable.action, action));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      db.select({
        id: auditLogTable.id,
        action: auditLogTable.action,
        targetType: auditLogTable.targetType,
        targetId: auditLogTable.targetId,
        details: auditLogTable.details,
        ipAddress: auditLogTable.ipAddress,
        criadoEm: auditLogTable.criadoEm,
        adminUsername: usersTable.username,
      })
        .from(auditLogTable)
        .leftJoin(usersTable, eq(auditLogTable.adminId, usersTable.id))
        .where(where)
        .orderBy(desc(auditLogTable.criadoEm))
        .limit(limitNum)
        .offset(offset),
      db.select({ total: count() }).from(auditLogTable).where(where),
    ]);

    res.json({
      data: rows,
      total: Number(total),
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(Number(total) / limitNum),
      hasMore: offset + limitNum < Number(total),
    });
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao ler audit log");
    res.status(500).json({ error: "Erro interno." });
  }
});


export default router;
