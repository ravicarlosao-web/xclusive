/**
 * Admin API routes — /api/admin/*
 *
 * All routes are currently wired to mock data.
 * Schema is fully defined in lib/db/src/schema/admin.ts and lib/db/src/schema/users.ts.
 * Connect to the real DB by replacing the mock helpers with actual Drizzle queries.
 *
 * Security:
 *   - All routes require the requireAdmin middleware (role: admin | superadmin).
 *   - Rate limiting is applied at the router level (100 req/min per IP).
 *   - All destructive actions write to the audit log mock.
 */

import { Router } from "express";
import { requireAdmin, type AdminRequest } from "../middlewares/requireAdmin.js";

const router = Router();

// ── Rate limiting (simple in-memory, swap for express-rate-limit in prod) ────
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
    return res.status(429).json({ error: "Demasiadas requisições. Tente novamente em 1 minuto." });
  }
  next();
}

// ── Login (public — must be before requireAdmin middleware) ──────────────────
router.post("/admin/auth/login", (req, res) => {
  const { email, password } = req.body ?? {};

  // Mock: accept any admin@xclusive.com / admin123
  if (email === "admin@xclusive.com" && password === "admin123") {
    return res.json({
      token: "mock-admin-token",
      user: {
        id: 1,
        username: "admin",
        nomeExibicao: "Administrador",
        email: "admin@xclusive.com",
        role: "admin",
        avatarUrl: null,
      },
      expiresIn: 14400, // 4h
    });
  }

  return res.status(401).json({ error: "Credenciais inválidas" });
});

router.use("/admin", rateLimit, requireAdmin);

// ────────────────────────────────────────────────────────────────────────────
// MOCK DATA HELPERS
// ────────────────────────────────────────────────────────────────────────────

const mockUsers = Array.from({ length: 48 }, (_, i) => ({
  id: i + 1,
  username: `utilizador${i + 1}`,
  nomeExibicao: ["Ana Silva", "Pedro Costa", "Maria Santos", "João Ferreira", "Carla Mendes", "Lucas Oliveira", "Sofia Rodrigues", "Miguel Alves", "Beatriz Lopes", "Rui Martins"][i % 10] + (i >= 10 ? ` ${Math.floor(i / 10) + 1}` : ""),
  email: `user${i + 1}@exemplo.com`,
  role: i === 0 ? "admin" : i < 15 ? "creator" : "user",
  tipoConta: i < 15 ? "criador" : "pessoal",
  pais: ["AO", "PT", "BR", "MZ", "ZA"][i % 5],
  estado: i % 7 === 0 ? "suspenso" : "ativo",
  avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${i}`,
  verificado: i < 8,
  saldo: Math.floor(Math.random() * 50000),
  ganhos: Math.floor(Math.random() * 200000),
  criadoEm: new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000).toISOString(),
}));

const mockReports = Array.from({ length: 22 }, (_, i) => ({
  id: i + 1,
  reporterId: (i % 10) + 2,
  reporterUsername: `utilizador${(i % 10) + 2}`,
  targetType: ["post", "comment", "user", "message"][i % 4],
  targetId: i + 10,
  reason: ["spam", "harassment", "nudity_minor", "copyright", "other"][i % 5],
  description: "Conteúdo inadequado reportado pelo utilizador.",
  status: ["pending", "reviewing", "resolved", "dismissed"][i % 4],
  resolvedBy: i % 4 >= 2 ? 1 : null,
  resolvedAt: i % 4 >= 2 ? new Date(Date.now() - i * 60 * 60 * 1000).toISOString() : null,
  criadoEm: new Date(Date.now() - i * 3 * 60 * 60 * 1000).toISOString(),
}));

const mockWithdrawals = Array.from({ length: 14 }, (_, i) => ({
  id: i + 1,
  creatorId: i + 2,
  creatorUsername: `utilizador${i + 2}`,
  amount: (Math.floor(Math.random() * 900) + 100) * 100,
  method: ["bank_transfer", "multicaixa_express", "paypal"][i % 3],
  destinationDetails: { iban: `AO06 0006 0000 00000${i + 1} 1${i + 1}1 4` },
  status: ["pending", "approved", "rejected", "paid"][i % 4],
  processedBy: i % 4 >= 1 ? 1 : null,
  processedAt: i % 4 >= 1 ? new Date(Date.now() - i * 12 * 60 * 60 * 1000).toISOString() : null,
  notes: i % 4 === 2 ? "Documentação insuficiente." : null,
  criadoEm: new Date(Date.now() - i * 6 * 60 * 60 * 1000).toISOString(),
}));

const mockAuditLog = Array.from({ length: 30 }, (_, i) => ({
  id: i + 1,
  adminId: 1,
  adminUsername: "admin",
  action: ["user_suspend", "user_delete", "withdrawal_approve", "withdrawal_reject", "report_resolve", "kyc_approve", "kyc_reject", "balance_adjustment", "settings_update", "broadcast_send"][i % 10],
  targetType: ["user", "user", "withdrawal", "withdrawal", "report", "user", "user", "user", "platform", "notification"][i % 10],
  targetId: (i % 20) + 1,
  details: { motivo: "Ação administrativa de rotina." },
  ipAddress: `192.168.1.${(i % 50) + 1}`,
  criadoEm: new Date(Date.now() - i * 2 * 60 * 60 * 1000).toISOString(),
}));

const mockPosts = Array.from({ length: 20 }, (_, i) => ({
  id: i + 1,
  autorId: (i % 15) + 1,
  autorUsername: `utilizador${(i % 15) + 1}`,
  autorAvatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${i % 15}`,
  legenda: `Post de exemplo número ${i + 1}`,
  tipo: ["imagem", "video", "carrossel"][i % 3],
  mediaUrls: [`https://picsum.photos/seed/${i}/400/400`],
  exclusivo: i % 3 === 0,
  totalCurtidas: Math.floor(Math.random() * 500),
  totalComentarios: Math.floor(Math.random() * 50),
  criadoEm: new Date(Date.now() - i * 4 * 60 * 60 * 1000).toISOString(),
}));

const mockTransactions = Array.from({ length: 40 }, (_, i) => ({
  id: i + 1,
  tipo: ["gorjeta", "subscricao", "ppv"][i % 3],
  valor: ([500, 1000, 2000, 5000][i % 4]),
  pagadorId: (i % 10) + 5,
  pagadorUsername: `utilizador${(i % 10) + 5}`,
  recetorId: (i % 8) + 2,
  recetorUsername: `utilizador${(i % 8) + 2}`,
  comissao: ([500, 1000, 2000, 5000][i % 4]) * 0.2,
  criadoEm: new Date(Date.now() - i * 3 * 60 * 60 * 1000).toISOString(),
}));

const mockSettings = {
  commission_rate: { value: 20 },
  maintenance_mode: { enabled: false },
  allowed_countries: { list: ["AO", "PT", "BR", "MZ", "ZA", "FR", "GB", "US"] },
  min_withdrawal_amount: { value: 5000 },
};

const mockBroadcastHistory = Array.from({ length: 6 }, (_, i) => ({
  id: i + 1,
  titulo: `Comunicado ${i + 1}`,
  mensagem: `Mensagem de broadcast número ${i + 1} enviada a todos os utilizadores da plataforma.`,
  segmento: ["todos", "criadores", "utilizadores", "pais:AO"][i % 4],
  totalEnviados: Math.floor(Math.random() * 1000) + 200,
  totalLidos: Math.floor(Math.random() * 500) + 50,
  enviadoPor: 1,
  criadoEm: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString(),
}));

function paginate<T>(items: T[], page = 1, limit = 10) {
  const offset = (page - 1) * limit;
  return {
    data: items.slice(offset, offset + limit),
    total: items.length,
    page,
    limit,
    totalPages: Math.ceil(items.length / limit),
    hasMore: offset + limit < items.length,
  };
}


// ────────────────────────────────────────────────────────────────────────────
// DASHBOARD
// ────────────────────────────────────────────────────────────────────────────

router.get("/admin/dashboard/kpis", (req, res) => {
  res.json({
    totalUtilizadores: 48,
    totalCriadores: 15,
    novosHoje: 3,
    receitaTotal: 1_250_000,
    comissaoMes: 85_000,
    postsHoje: 12,
    denunciasPendentes: mockReports.filter(r => r.status === "pending").length,
    levantamentosPendentes: mockWithdrawals.filter(w => w.status === "pending").length,
  });
});

router.get("/admin/dashboard/charts", (req, res) => {
  const today = new Date();
  const days30 = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (29 - i));
    return {
      data: d.toISOString().split("T")[0],
      novosUtilizadores: Math.floor(Math.random() * 8) + 1,
      gorjetas: Math.floor(Math.random() * 30000) + 5000,
      subscricoes: Math.floor(Math.random() * 50000) + 10000,
      ppv: Math.floor(Math.random() * 20000) + 2000,
    };
  });

  const top10Criadores = mockUsers
    .filter(u => u.tipoConta === "criador")
    .slice(0, 10)
    .map(u => ({ id: u.id, username: u.username, nomeExibicao: u.nomeExibicao, ganhos: u.ganhos, avatarUrl: u.avatarUrl }))
    .sort((a, b) => b.ganhos - a.ganhos);

  const distribuicaoPaises = ["AO", "PT", "BR", "MZ", "ZA"].map(p => ({
    pais: p,
    total: mockUsers.filter(u => u.pais === p).length,
  }));

  res.json({ dias30: days30, top10Criadores, distribuicaoPaises });
});

router.get("/admin/dashboard/activity-feed", (req, res) => {
  const feed = [
    { tipo: "novo_registo", mensagem: "Sofia Rodrigues registou-se", criadoEm: new Date(Date.now() - 5 * 60 * 1000).toISOString() },
    { tipo: "nova_denuncia", mensagem: "Denúncia de spam recebida (post #14)", criadoEm: new Date(Date.now() - 18 * 60 * 1000).toISOString() },
    { tipo: "novo_levantamento", mensagem: "Pedido de levantamento de 5.000 AOA", criadoEm: new Date(Date.now() - 35 * 60 * 1000).toISOString() },
    { tipo: "kyc_submetido", mensagem: "Pedro Costa submeteu KYC para aprovação", criadoEm: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString() },
    { tipo: "novo_registo", mensagem: "Lucas Oliveira registou-se", criadoEm: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
    { tipo: "nova_denuncia", mensagem: "Denúncia de assédio recebida (user #7)", criadoEm: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() },
  ];
  res.json(feed);
});

// ────────────────────────────────────────────────────────────────────────────
// USERS
// ────────────────────────────────────────────────────────────────────────────

router.get("/admin/users", (req, res) => {
  const { page = "1", limit = "10", role, pais, estado, search } = req.query as Record<string, string>;
  let filtered = [...mockUsers];
  if (role) filtered = filtered.filter(u => u.role === role);
  if (pais) filtered = filtered.filter(u => u.pais === pais);
  if (estado) filtered = filtered.filter(u => u.estado === estado);
  if (search) filtered = filtered.filter(u =>
    u.username.includes(search) || u.email.includes(search) || u.nomeExibicao.toLowerCase().includes(search.toLowerCase())
  );
  res.json(paginate(filtered, Number(page), Number(limit)));
});

router.get("/admin/users/:id", (req, res) => {
  const user = mockUsers.find(u => u.id === Number(req.params.id));
  if (!user) return res.status(404).json({ error: "Utilizador não encontrado" });
  res.json({
    ...user,
    totalPosts: Math.floor(Math.random() * 50),
    totalComentarios: Math.floor(Math.random() * 200),
    totalSeguidores: Math.floor(Math.random() * 1000),
    totalSeguindo: Math.floor(Math.random() * 500),
    ultimoLogin: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString(),
    denunciasRecebidas: mockReports.filter(r => r.targetType === "user" && r.targetId === Number(req.params.id)),
    historicoTransacoes: mockTransactions.filter(t => t.recetorId === Number(req.params.id)).slice(0, 5),
  });
});

router.patch("/admin/users/:id", requireAdmin, (req: AdminRequest, res) => {
  const user = mockUsers.find(u => u.id === Number(req.params.id));
  if (!user) return res.status(404).json({ error: "Utilizador não encontrado" });
  Object.assign(user, req.body);
  mockAuditLog.unshift({ id: mockAuditLog.length + 1, adminId: req.adminId!, adminUsername: req.adminUsername!, action: "user_edit", targetType: "user", targetId: user.id, details: req.body, ipAddress: req.ip ?? "", criadoEm: new Date().toISOString() });
  res.json(user);
});

router.patch("/admin/users/:id/status", requireAdmin, (req: AdminRequest, res) => {
  const user = mockUsers.find(u => u.id === Number(req.params.id));
  if (!user) return res.status(404).json({ error: "Utilizador não encontrado" });
  const { estado } = req.body;
  user.estado = estado;
  mockAuditLog.unshift({ id: mockAuditLog.length + 1, adminId: req.adminId!, adminUsername: req.adminUsername!, action: estado === "suspenso" ? "user_suspend" : "user_reactivate", targetType: "user", targetId: user.id, details: { estado }, ipAddress: req.ip ?? "", criadoEm: new Date().toISOString() });
  res.json(user);
});

router.patch("/admin/users/:id/role", requireAdmin, (req: AdminRequest, res) => {
  const user = mockUsers.find(u => u.id === Number(req.params.id));
  if (!user) return res.status(404).json({ error: "Utilizador não encontrado" });
  user.role = req.body.role;
  mockAuditLog.unshift({ id: mockAuditLog.length + 1, adminId: req.adminId!, adminUsername: req.adminUsername!, action: "user_role_change", targetType: "user", targetId: user.id, details: { role: req.body.role }, ipAddress: req.ip ?? "", criadoEm: new Date().toISOString() });
  res.json(user);
});

router.delete("/admin/users/:id", requireAdmin, (req: AdminRequest, res) => {
  const idx = mockUsers.findIndex(u => u.id === Number(req.params.id));
  if (idx < 0) return res.status(404).json({ error: "Utilizador não encontrado" });
  mockAuditLog.unshift({ id: mockAuditLog.length + 1, adminId: req.adminId!, adminUsername: req.adminUsername!, action: "user_delete", targetType: "user", targetId: Number(req.params.id), details: {}, ipAddress: req.ip ?? "", criadoEm: new Date().toISOString() });
  mockUsers[idx].estado = "eliminado";
  res.json({ success: true });
});

// ────────────────────────────────────────────────────────────────────────────
// CREATORS
// ────────────────────────────────────────────────────────────────────────────

router.get("/admin/creators", (req, res) => {
  const { page = "1", limit = "10" } = req.query as Record<string, string>;
  const creators = mockUsers.filter(u => u.tipoConta === "criador");
  res.json(paginate(creators, Number(page), Number(limit)));
});

router.get("/admin/creators/kyc-queue", (req, res) => {
  const queue = mockUsers.filter(u => u.tipoConta === "criador" && !u.verificado).map(u => ({
    ...u,
    kycSubmissao: {
      documentoFrente: `https://picsum.photos/seed/doc-f-${u.id}/600/400`,
      documentoVerso: `https://picsum.photos/seed/doc-v-${u.id}/600/400`,
      selfie: `https://picsum.photos/seed/selfie-${u.id}/600/400`,
      provaDeMorada: `https://picsum.photos/seed/morada-${u.id}/600/400`,
      selfieComDocumento: `https://picsum.photos/seed/selfie-doc-${u.id}/600/400`,
      videoVerificacao: null,
      submissaoEm: new Date(Date.now() - u.id * 2 * 60 * 60 * 1000).toISOString(),
    },
  }));
  res.json(queue);
});

router.patch("/admin/creators/:id/kyc", requireAdmin, (req: AdminRequest, res) => {
  const user = mockUsers.find(u => u.id === Number(req.params.id));
  if (!user) return res.status(404).json({ error: "Criador não encontrado" });
  const { acao, motivo } = req.body;
  if (acao === "aprovar") user.verificado = true;
  mockAuditLog.unshift({ id: mockAuditLog.length + 1, adminId: req.adminId!, adminUsername: req.adminUsername!, action: `kyc_${acao}`, targetType: "user", targetId: user.id, details: { motivo }, ipAddress: req.ip ?? "", criadoEm: new Date().toISOString() });
  res.json({ success: true, user });
});

router.get("/admin/creators/:id/plans", (req, res) => {
  res.json([
    { id: 1, nome: "Básico", preco: 999, beneficios: "Acesso a conteúdo exclusivo", ativo: true, totalSubscritores: 12 },
    { id: 2, nome: "Premium", preco: 2499, beneficios: "Acesso total + mensagens diretas", ativo: true, totalSubscritores: 5 },
  ]);
});

router.patch("/admin/creators/:id/plans/:planId", requireAdmin, (req: AdminRequest, res) => {
  res.json({ success: true, ...req.body });
});

router.post("/admin/creators/:id/balance-adjustment", requireAdmin, (req: AdminRequest, res) => {
  const user = mockUsers.find(u => u.id === Number(req.params.id));
  if (!user) return res.status(404).json({ error: "Criador não encontrado" });
  const { valor, motivo } = req.body;
  user.saldo += valor;
  mockAuditLog.unshift({ id: mockAuditLog.length + 1, adminId: req.adminId!, adminUsername: req.adminUsername!, action: "balance_adjustment", targetType: "user", targetId: user.id, details: { valor, motivo }, ipAddress: req.ip ?? "", criadoEm: new Date().toISOString() });
  res.json({ success: true, novoSaldo: user.saldo });
});

// ────────────────────────────────────────────────────────────────────────────
// CONTENT & REPORTS
// ────────────────────────────────────────────────────────────────────────────

router.get("/admin/posts", (req, res) => {
  const { page = "1", limit = "10" } = req.query as Record<string, string>;
  res.json(paginate(mockPosts, Number(page), Number(limit)));
});

router.delete("/admin/posts/:id", requireAdmin, (req: AdminRequest, res) => {
  const idx = mockPosts.findIndex(p => p.id === Number(req.params.id));
  if (idx < 0) return res.status(404).json({ error: "Post não encontrado" });
  mockAuditLog.unshift({ id: mockAuditLog.length + 1, adminId: req.adminId!, adminUsername: req.adminUsername!, action: "post_delete", targetType: "post", targetId: Number(req.params.id), details: { motivo: req.body?.motivo }, ipAddress: req.ip ?? "", criadoEm: new Date().toISOString() });
  mockPosts.splice(idx, 1);
  res.json({ success: true });
});

router.get("/admin/reports", (req, res) => {
  const { page = "1", limit = "10", targetType, status, reason } = req.query as Record<string, string>;
  let filtered = [...mockReports];
  if (targetType) filtered = filtered.filter(r => r.targetType === targetType);
  if (status) filtered = filtered.filter(r => r.status === status);
  if (reason) filtered = filtered.filter(r => r.reason === reason);
  res.json(paginate(filtered, Number(page), Number(limit)));
});

router.patch("/admin/reports/:id", requireAdmin, (req: AdminRequest, res) => {
  const report = mockReports.find(r => r.id === Number(req.params.id));
  if (!report) return res.status(404).json({ error: "Denúncia não encontrada" });
  Object.assign(report, req.body, { resolvedBy: req.adminId, resolvedAt: new Date().toISOString() });
  mockAuditLog.unshift({ id: mockAuditLog.length + 1, adminId: req.adminId!, adminUsername: req.adminUsername!, action: "report_resolve", targetType: "report", targetId: report.id, details: req.body, ipAddress: req.ip ?? "", criadoEm: new Date().toISOString() });
  res.json(report);
});

// ────────────────────────────────────────────────────────────────────────────
// FINANCE
// ────────────────────────────────────────────────────────────────────────────

router.get("/admin/finance/kpis", (req, res) => {
  res.json({
    receitaTotal: 4_250_000,
    comissaoRetida: 850_000,
    pagoCriadores: 3_400_000,
    ticketMedio: 1_250,
    receitaMes: 425_000,
    crescimentoMes: 12.5,
  });
});

router.get("/admin/finance/transactions", (req, res) => {
  const { page = "1", limit = "10", tipo } = req.query as Record<string, string>;
  let filtered = [...mockTransactions];
  if (tipo) filtered = filtered.filter(t => t.tipo === tipo);
  res.json(paginate(filtered, Number(page), Number(limit)));
});

router.get("/admin/finance/transactions/export", (req, res) => {
  const headers = ["id", "tipo", "valor", "pagador", "recetor", "comissao", "criadoEm"];
  const rows = mockTransactions.map(t =>
    [t.id, t.tipo, t.valor, t.pagadorUsername, t.recetorUsername, t.comissao, t.criadoEm].join(",")
  );
  const csv = [headers.join(","), ...rows].join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=transacoes.csv");
  res.send(csv);
});

router.get("/admin/withdrawals", (req, res) => {
  const { page = "1", limit = "10", status } = req.query as Record<string, string>;
  let filtered = [...mockWithdrawals];
  if (status) filtered = filtered.filter(w => w.status === status);
  res.json(paginate(filtered, Number(page), Number(limit)));
});

router.patch("/admin/withdrawals/:id", requireAdmin, (req: AdminRequest, res) => {
  const withdrawal = mockWithdrawals.find(w => w.id === Number(req.params.id));
  if (!withdrawal) return res.status(404).json({ error: "Pedido não encontrado" });
  Object.assign(withdrawal, req.body, { processedBy: req.adminId, processedAt: new Date().toISOString() });
  mockAuditLog.unshift({ id: mockAuditLog.length + 1, adminId: req.adminId!, adminUsername: req.adminUsername!, action: `withdrawal_${req.body.status}`, targetType: "withdrawal", targetId: withdrawal.id, details: req.body, ipAddress: req.ip ?? "", criadoEm: new Date().toISOString() });
  res.json(withdrawal);
});

// ────────────────────────────────────────────────────────────────────────────
// BROADCAST
// ────────────────────────────────────────────────────────────────────────────

router.post("/admin/broadcast", requireAdmin, (req: AdminRequest, res) => {
  const { titulo, mensagem, segmento } = req.body;
  const novo = {
    id: mockBroadcastHistory.length + 1,
    titulo,
    mensagem,
    segmento: segmento ?? "todos",
    totalEnviados: segmento === "criadores" ? 15 : segmento?.startsWith("pais:") ? 10 : 48,
    totalLidos: 0,
    enviadoPor: req.adminId!,
    criadoEm: new Date().toISOString(),
  };
  mockBroadcastHistory.unshift(novo);
  mockAuditLog.unshift({ id: mockAuditLog.length + 1, adminId: req.adminId!, adminUsername: req.adminUsername!, action: "broadcast_send", targetType: "notification", targetId: novo.id, details: { titulo, segmento }, ipAddress: req.ip ?? "", criadoEm: new Date().toISOString() });
  res.status(201).json(novo);
});

router.get("/admin/broadcast/history", (req, res) => {
  res.json(mockBroadcastHistory);
});

// ────────────────────────────────────────────────────────────────────────────
// SETTINGS
// ────────────────────────────────────────────────────────────────────────────

router.get("/admin/settings", (req, res) => {
  res.json(mockSettings);
});

router.patch("/admin/settings", requireAdmin, (req: AdminRequest, res) => {
  Object.assign(mockSettings, req.body);
  mockAuditLog.unshift({ id: mockAuditLog.length + 1, adminId: req.adminId!, adminUsername: req.adminUsername!, action: "settings_update", targetType: "platform", targetId: 0, details: req.body, ipAddress: req.ip ?? "", criadoEm: new Date().toISOString() });
  res.json(mockSettings);
});

// ────────────────────────────────────────────────────────────────────────────
// AUDIT LOG
// ────────────────────────────────────────────────────────────────────────────

router.get("/admin/audit-log", (req, res) => {
  const { page = "1", limit = "10", adminId, action } = req.query as Record<string, string>;
  let filtered = [...mockAuditLog];
  if (adminId) filtered = filtered.filter(l => l.adminId === Number(adminId));
  if (action) filtered = filtered.filter(l => l.action === action);
  res.json(paginate(filtered, Number(page), Number(limit)));
});

export default router;
