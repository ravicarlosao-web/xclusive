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
  inArray,
} from "drizzle-orm";
import bcrypt from "bcryptjs";
import { getPublicUrl } from "../lib/storage.js";

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

function mapEstado(ativo: boolean): string {
  return ativo ? "ativo" : "suspenso";
}

function mapUser(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    nomeExibicao: u.nomeExibicao,
    bio: u.bio ?? null,
    avatarUrl: u.avatarUrl ?? null,
    capaUrl: u.capaUrl ?? null,
    tipoConta: u.tipoConta,
    verificado: u.verificado,
    privado: u.privado,
    role: u.role,
    estado: mapEstado(u.ativo),
    saldo: Number(u.saldo),
    ganhos: Number(u.ganhos),
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
    const upstream = await fetch(rawUrl);
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
      avatarUrl: user.avatarUrl ?? null,
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
      [{ levantamentosPendentes }],
      [{ receitaTotal }],
      [{ comissaoMes }],
    ] = await Promise.all([
      db.select({ totalUtilizadores: count() }).from(usersTable),
      db.select({ totalCriadores: count() }).from(usersTable)
        .where(eq(usersTable.tipoConta, "criador")),
      db.select({ novosHoje: count() }).from(usersTable)
        .where(gte(usersTable.criadoEm, hoje)),
      db.select({ postsHoje: count() }).from(postsTable)
        .where(gte(postsTable.criadoEm, hoje)),
      db.select({ denunciasPendentes: count() }).from(reportsTable)
        .where(eq(reportsTable.status, "pending")),
      db.select({ levantamentosPendentes: count() }).from(withdrawalRequestsTable)
        .where(eq(withdrawalRequestsTable.status, "pending")),
      db.select({ receitaTotal: sum(purchasesTable.valor) }).from(purchasesTable),
      db.select({ comissaoMes: sum(purchasesTable.valor) }).from(purchasesTable)
        .where(gte(purchasesTable.criadoEm, new Date(hoje.getFullYear(), hoje.getMonth(), 1))),
    ]);

    const receitaTotalNum = Number(receitaTotal ?? 0);
    const comissaoMesNum = Number(comissaoMes ?? 0) * 0.2; // 20% comissão

    res.json({
      totalUtilizadores: Number(totalUtilizadores),
      totalCriadores: Number(totalCriadores),
      novosHoje: Number(novosHoje),
      receitaTotal: receitaTotalNum,
      comissaoMes: comissaoMesNum,
      postsHoje: Number(postsHoje),
      denunciasPendentes: Number(denunciasPendentes),
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
      top10Criadores: top10.map(u => ({ ...u, ganhos: Number(u.ganhos) })),
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
    case "user_suspend": return `${admin} suspendeu utilizador${target}`;
    case "user_reactivate": return `${admin} reactivou utilizador${target}`;
    case "user_delete": return `${admin} eliminou utilizador${target}`;
    case "user_role_change": return `${admin} alterou role do utilizador${target}`;
    case "user_edit": return `${admin} editou utilizador${target}`;
    case "kyc_aprovar": return `${admin} aprovou KYC do criador${target}`;
    case "kyc_rejeitar": return `${admin} rejeitou KYC do criador${target}`;
    case "post_delete": return `${admin} eliminou post${target}`;
    case "report_resolve": return `${admin} resolveu denúncia${target}`;
    case "withdrawal_approved": return `${admin} aprovou levantamento${target}`;
    case "withdrawal_rejected": return `${admin} rejeitou levantamento${target}`;
    case "withdrawal_paid": return `${admin} marcou levantamento${target} como pago`;
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
    if (role) conditions.push(eq(usersTable.role, role));
    if (estado === "suspenso") conditions.push(eq(usersTable.ativo, false));
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

    res.json({
      ...mapUser(user),
      totalPosts: Number(totalPosts),
      totalSeguidores: Number(totalSeguidores),
      totalSeguindo: Number(totalSeguindo),
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

    const { estado } = req.body;
    if (!["ativo", "suspenso"].includes(estado)) {
      return void res.status(400).json({ error: "Estado inválido. Use 'ativo' ou 'suspenso'." });
    }
    const novoAtivo = estado === "ativo";
    const estadoAnterior = mapEstado(user.ativo);

    const [updated] = await db.update(usersTable).set({ ativo: novoAtivo }).where(eq(usersTable.id, id)).returning();
    await logAudit(req, novoAtivo ? "user_reactivate" : "user_suspend", "user", id, {
      before: { estado: estadoAnterior }, after: { estado },
    });
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

    // Soft delete — desactiva a conta sem eliminar os dados
    await db.update(usersTable).set({ ativo: false }).where(eq(usersTable.id, id));
    await logAudit(req, "user_delete", "user", id, { before: { ativo: user.ativo }, after: { ativo: false } });
    res.json({ success: true });
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao eliminar utilizador");
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

    res.json(queue.map(u => {
      const submission = submissionByUser.get(u.id);
      return {
        ...mapUser(u),
        kycSubmissao: submission ? {
          documentoFrente: signMediaUrl(getPublicUrl(submission.documentoKey)),
          documentoVerso: null,
          selfie: signMediaUrl(getPublicUrl(submission.selfieKey)),
          provaDeMorada: null,
          selfieComDocumento: null,
          videoVerificacao: signMediaUrl(getPublicUrl(submission.livenessKey)),
          submissaoEm: submission.submetidoEm,
        } : null,
      };
    }));
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao obter fila KYC");
    res.status(500).json({ error: "Erro interno." });
  }
});

router.patch("/admin/creators/:id/kyc", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const [user] = await db.select().from(usersTable)
      .where(and(eq(usersTable.id, id), eq(usersTable.tipoConta, "criador"))).limit(1);
    if (!user) return void res.status(404).json({ error: "Criador não encontrado" });

    const acao = req.body?.acao ?? (req.body?.status === "aprovado" ? "aprovar" : req.body?.status === "rejeitado" ? "rejeitar" : undefined);
    const motivo = req.body?.motivo ?? req.body?.reason;
    if (!["aprovar", "rejeitar"].includes(acao)) {
      return void res.status(400).json({ error: "Acção inválida. Use 'aprovar' ou 'rejeitar'." });
    }

    const verificadoAnterior = user.verificado;
    const [updated] = await db.update(usersTable)
      .set({ verificado: acao === "aprovar" })
      .where(eq(usersTable.id, id))
      .returning();

    const [submission] = await db.select({ id: kycSubmissionsTable.id })
      .from(kycSubmissionsTable)
      .where(and(eq(kycSubmissionsTable.userId, id), eq(kycSubmissionsTable.status, "pendente")))
      .orderBy(sql`${kycSubmissionsTable.submetidoEm} DESC`)
      .limit(1);
    if (submission) {
      await db.update(kycSubmissionsTable)
        .set({
          status: acao === "aprovar" ? "aprovado" : "rejeitado",
          motivoRejeicao: acao === "rejeitar" ? (motivo ?? null) : null,
          revistoEm: new Date(),
          revistoPor: req.adminId!,
        })
        .where(eq(kycSubmissionsTable.id, submission.id));
    }

    await logAudit(req, `kyc_${acao}`, "user", id, {
      before: { verificado: verificadoAnterior },
      after: { verificado: updated.verificado },
      motivo: motivo ?? null,
    });
    res.json({ success: true, user: mapUser(updated) });
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao processar KYC");
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
    const [user] = await db.select().from(usersTable)
      .where(and(eq(usersTable.id, id), eq(usersTable.tipoConta, "criador"))).limit(1);
    if (!user) return void res.status(404).json({ error: "Criador não encontrado" });

    const { valor, motivo } = req.body;
    const valorNum = Number(valor);
    if (!Number.isFinite(valorNum)) {
      return void res.status(400).json({ error: "Valor inválido." });
    }

    const saldoAnterior = Number(user.saldo);
    const novoSaldo = saldoAnterior + valorNum;

    await db.update(usersTable)
      .set({ saldo: String(novoSaldo) })
      .where(eq(usersTable.id, id));

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

    res.json(paginate(rows, Number(total), pageNum, limitNum));
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao listar posts");
    res.status(500).json({ error: "Erro interno." });
  }
});

router.delete("/admin/posts/:id", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const [post] = await db.select().from(postsTable).where(eq(postsTable.id, id)).limit(1);
    if (!post) return void res.status(404).json({ error: "Post não encontrado" });

    await db.delete(postsTable).where(eq(postsTable.id, id));
    await logAudit(req, "post_delete", "post", id, { motivo: req.body?.motivo ?? null });
    res.json({ success: true });
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao eliminar post");
    res.status(500).json({ error: "Erro interno." });
  }
});

router.get("/admin/reports", async (req, res) => {
  try {
    const { page = "1", limit = "10", targetType, status, reason } = req.query as Record<string, string>;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions: any[] = [];
    if (targetType) conditions.push(eq(reportsTable.targetType, targetType));
    if (status) conditions.push(eq(reportsTable.status, status));
    if (reason) conditions.push(eq(reportsTable.reason, reason));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      db.select({
        id: reportsTable.id,
        reporterId: reportsTable.reporterId,
        reporterUsername: usersTable.username,
        targetType: reportsTable.targetType,
        targetId: reportsTable.targetId,
        reason: reportsTable.reason,
        description: reportsTable.description,
        status: reportsTable.status,
        resolvedBy: reportsTable.resolvedBy,
        resolvedAt: reportsTable.resolvedAt,
        criadoEm: reportsTable.criadoEm,
      })
        .from(reportsTable)
        .leftJoin(usersTable, eq(reportsTable.reporterId, usersTable.id))
        .where(where)
        .orderBy(desc(reportsTable.criadoEm))
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

router.patch("/admin/reports/:id", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const [report] = await db.select().from(reportsTable).where(eq(reportsTable.id, id)).limit(1);
    if (!report) return void res.status(404).json({ error: "Denúncia não encontrada" });

    const STATUS_VALIDOS = ["pending", "reviewing", "resolved", "dismissed"] as const;
    if (req.body.status !== undefined && !STATUS_VALIDOS.includes(req.body.status)) {
      return void res.status(400).json({ error: `Status inválido. Valores permitidos: ${STATUS_VALIDOS.join(", ")}` });
    }

    const statusAnterior = report.status;
    const updates: Partial<typeof reportsTable.$inferInsert> = {
      resolvedBy: req.adminId ?? undefined,
      resolvedAt: new Date(),
    };
    if (req.body.status !== undefined) updates.status = req.body.status;
    if (typeof req.body.description === "string") updates.description = req.body.description.slice(0, 1000);

    const [updated] = await db.update(reportsTable).set(updates).where(eq(reportsTable.id, id)).returning();
    await logAudit(req, "report_resolve", "report", id, {
      before: { status: statusAnterior }, after: { status: updated.status },
    });
    res.json(updated);
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao resolver denúncia");
    res.status(500).json({ error: "Erro interno." });
  }
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
      [{ receitaTotal }],
      [{ receitaMes }],
      [{ totalTransacoes }],
    ] = await Promise.all([
      db.select({ receitaTotal: sum(purchasesTable.valor) }).from(purchasesTable),
      db.select({ receitaMes: sum(purchasesTable.valor) }).from(purchasesTable)
        .where(gte(purchasesTable.criadoEm, inicioMes)),
      db.select({ totalTransacoes: count() }).from(purchasesTable),
    ]);

    const total = Number(receitaTotal ?? 0);
    const mes = Number(receitaMes ?? 0);
    const txCount = Number(totalTransacoes);
    const COMISSAO = 0.20;

    res.json({
      receitaTotal: total,
      comissaoRetida: total * COMISSAO,
      pagoCriadores: total * (1 - COMISSAO),
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
      rows.map(r => ({ ...r, valor: Number(r.valor), comissao: Number(r.valor) * 0.20 })),
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

router.get("/admin/withdrawals", async (req, res) => {
  try {
    const { page = "1", limit = "10", status } = req.query as Record<string, string>;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions: any[] = [];
    if (status) conditions.push(eq(withdrawalRequestsTable.status, status));
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
        // destinationDetails intencionalmente omitido da listagem (dados bancários sensíveis)
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
      rows.map(r => ({ ...r, amount: Number(r.amount) })),
      Number(total), pageNum, limitNum
    ));
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao listar levantamentos");
    res.status(500).json({ error: "Erro interno." });
  }
});

router.patch("/admin/withdrawals/:id", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const [withdrawal] = await db.select().from(withdrawalRequestsTable)
      .where(eq(withdrawalRequestsTable.id, id)).limit(1);
    if (!withdrawal) return void res.status(404).json({ error: "Pedido não encontrado" });

    const STATUS_VALIDOS = ["pending", "approved", "rejected", "paid"] as const;
    if (req.body.status !== undefined && !STATUS_VALIDOS.includes(req.body.status)) {
      return void res.status(400).json({ error: `Status inválido. Valores permitidos: ${STATUS_VALIDOS.join(", ")}` });
    }

    const statusAnterior = withdrawal.status;
    const updates: Partial<typeof withdrawalRequestsTable.$inferInsert> = {
      processedBy: req.adminId ?? undefined,
      processedAt: new Date(),
    };
    if (req.body.status !== undefined) updates.status = req.body.status;
    if (typeof req.body.notes === "string") updates.notes = req.body.notes.slice(0, 500);

    const [updated] = await db.update(withdrawalRequestsTable).set(updates)
      .where(eq(withdrawalRequestsTable.id, id)).returning();

    await logAudit(req, `withdrawal_${updated.status}`, "withdrawal", id, {
      before: { status: statusAnterior }, after: { status: updated.status, notes: updated.notes },
    });

    // Remover destinationDetails (IBAN) da resposta
    const { destinationDetails: _stripped, ...safeWithdrawal } = updated as any;
    res.json({ ...safeWithdrawal, amount: Number(safeWithdrawal.amount) });
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao processar levantamento");
    res.status(500).json({ error: "Erro interno." });
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

    // Guardar o broadcast no audit_log como registo
    await logAudit(req, "broadcast_send", "platform", null, {
      titulo,
      mensagem,
      segmento: segmento ?? "todos",
    });

    res.status(201).json({
      success: true,
      titulo,
      mensagem,
      segmento: segmento ?? "todos",
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

// Defaults aplicados quando a tabela está vazia
const DEFAULT_SETTINGS: Record<string, unknown> = {
  commission_rate: { value: 20 },
  maintenance_mode: { enabled: false },
  allowed_countries: { list: ["AO", "MZ", "ZA", "PT", "BR"] },
  min_withdrawal_amount: { value: 5000 },
};

router.get("/admin/settings", async (req, res) => {
  try {
    const rows = await db.select().from(platformSettingsTable);
    const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS };
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
  if (req.adminRole !== "superadmin") {
    return void res.status(403).json({ error: "Apenas superadmin pode alterar as definições da plataforma" });
  }

  try {
    const erros: string[] = [];
    const updates: Array<{ key: string; value: unknown }> = [];

    if (req.body.commission_rate !== undefined) {
      const val = Number(req.body.commission_rate?.value);
      if (!Number.isFinite(val) || val < 0 || val > 100) erros.push("commission_rate.value deve estar entre 0 e 100");
      else updates.push({ key: "commission_rate", value: { value: val } });
    }
    if (req.body.maintenance_mode !== undefined) {
      if (typeof req.body.maintenance_mode?.enabled !== "boolean") erros.push("maintenance_mode.enabled deve ser boolean");
      else updates.push({ key: "maintenance_mode", value: { enabled: req.body.maintenance_mode.enabled } });
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

    // Upsert cada definição
    for (const upd of updates) {
      await db.insert(platformSettingsTable)
        .values({ key: upd.key, value: upd as any, updatedBy: req.adminId ?? undefined })
        .onConflictDoUpdate({
          target: platformSettingsTable.key,
          set: { value: upd.value as any, updatedBy: req.adminId ?? undefined, updatedAt: new Date() },
        });
    }

    const afterRows = await db.select().from(platformSettingsTable);
    const after: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const r of afterRows) after[r.key] = r.value;

    await logAudit(req, "settings_update", "platform", 0, { before, after: Object.fromEntries(updates.map(u => [u.key, u.value])) });
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
