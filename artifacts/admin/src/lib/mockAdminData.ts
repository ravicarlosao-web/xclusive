export const kpis = {
  totalUsers: 12450,
  activeUsers: 8200,
  totalCreators: 450,
  kycPending: 12,
  reportsPending: 28,
  monthlyRevenue: 45200,
  withdrawalsPending: 5,
  activeSubscriptions: 3400
};

export const dashboardCharts = {
  revenueData: [
    { name: 'Jan', value: 12000 },
    { name: 'Fev', value: 19000 },
    { name: 'Mar', value: 25000 },
    { name: 'Abr', value: 32000 },
    { name: 'Mai', value: 41000 },
    { name: 'Jun', value: 45200 }
  ],
  userGrowthData: [
    { name: 'Jan', users: 8000, creators: 200 },
    { name: 'Fev', users: 9500, creators: 250 },
    { name: 'Mar', users: 10200, creators: 310 },
    { name: 'Abr', users: 11000, creators: 380 },
    { name: 'Mai', users: 11800, creators: 420 },
    { name: 'Jun', users: 12450, creators: 450 }
  ]
};

export const activityFeed = [
  { id: 1, type: 'user_registered', message: 'Novo utilizador registado: joaopedro99', timestamp: '2 mins ago' },
  { id: 2, type: 'kyc_submitted', message: 'Criador submeteu KYC: anasilva', timestamp: '15 mins ago' },
  { id: 3, type: 'report_created', message: 'Nova denúncia de conteúdo (ID: 4582)', timestamp: '1 hour ago' },
  { id: 4, type: 'withdrawal_requested', message: 'Pedido de levantamento: 50,000 MZN', timestamp: '2 hours ago' },
  { id: 5, type: 'subscription_purchased', message: 'Nova subscrição VIP - Carlos M.', timestamp: '3 hours ago' },
];

export const users = Array.from({ length: 50 }).map((_, i) => ({
  id: i + 1,
  username: `user_${i + 1}`,
  email: `user${i + 1}@example.com`,
  role: i % 5 === 0 ? 'creator' : 'user',
  pais: i % 3 === 0 ? 'Mozambique' : i % 3 === 1 ? 'Angola' : 'Portugal',
  estado: i % 10 === 0 ? 'suspenso' : 'ativo',
  joinedAt: new Date(Date.now() - Math.random() * 10000000000).toISOString()
}));

export const creators = users.filter(u => u.role === 'creator').map(c => ({
  ...c,
  balance: Math.floor(Math.random() * 100000),
  subscribers: Math.floor(Math.random() * 500)
}));

export const kycQueue = [
  { id: 101, username: 'mariacosta', submittedAt: new Date().toISOString(), status: 'pendente', documents: ['doc1.jpg', 'doc2.jpg'] },
  { id: 102, username: 'joaocarlos', submittedAt: new Date(Date.now() - 86400000).toISOString(), status: 'pendente', documents: ['doc1.jpg'] }
];

export const posts = Array.from({ length: 20 }).map((_, i) => ({
  id: i + 1,
  creatorId: (i % 10) + 1,
  creatorName: `creator_${(i % 10) + 1}`,
  content: `This is a sample post content #${i + 1}`,
  mediaType: i % 2 === 0 ? 'image' : 'video',
  mediaUrl: 'https://via.placeholder.com/400x300',
  likes: Math.floor(Math.random() * 1000),
  createdAt: new Date(Date.now() - Math.random() * 10000000).toISOString()
}));

export const reports = [
  { id: 1, targetType: 'post', targetId: 5, reporterId: 10, reason: 'Nudez explícita (não permitida)', status: 'pendente', createdAt: new Date().toISOString() },
  { id: 2, targetType: 'user', targetId: 15, reporterId: 2, reason: 'Spam', status: 'resolved', createdAt: new Date(Date.now() - 86400000).toISOString() }
];

export const financeKpis = {
  totalProcessed: 1250000,
  platformFees: 187500,
  payoutsCompleted: 950000,
  payoutsPending: 112500
};

export const transactions = Array.from({ length: 30 }).map((_, i) => ({
  id: `TRX-${1000 + i}`,
  type: i % 3 === 0 ? 'withdrawal' : 'subscription',
  amount: Math.floor(Math.random() * 5000) + 500,
  currency: 'MZN',
  user: `user_${Math.floor(Math.random() * 50) + 1}`,
  status: i % 5 === 0 ? 'pendente' : 'pago',
  date: new Date(Date.now() - Math.random() * 50000000).toISOString()
}));

export const withdrawals = [
  { id: 1, creator: 'creator_1', amount: 25000, currency: 'MZN', method: 'M-Pesa', account: '+258840000000', status: 'pendente', requestedAt: new Date().toISOString() },
  { id: 2, creator: 'creator_2', amount: 100000, currency: 'AOA', method: 'Bank Transfer', account: 'AO06...', status: 'aprovado', requestedAt: new Date(Date.now() - 86400000).toISOString() }
];

export const broadcastHistory = [
  { id: 1, title: 'Manutenção Programada', message: 'A plataforma estará offline amanhã.', segment: 'all', sentAt: new Date(Date.now() - 172800000).toISOString(), readRate: 45 },
  { id: 2, title: 'Novas Funcionalidades', message: 'Temos novas ferramentas para criadores!', segment: 'creators', sentAt: new Date(Date.now() - 604800000).toISOString(), readRate: 78 }
];

export const settings = {
  commissionRate: 15,
  maintenanceMode: false,
  allowedCountries: ['MZ', 'AO', 'PT', 'BR'],
  minWithdrawalAmount: 1000
};

export const auditLog = Array.from({ length: 40 }).map((_, i) => ({
  id: i + 1,
  admin: 'admin@xclusive.com',
  action: i % 3 === 0 ? 'approve_kyc' : i % 3 === 1 ? 'suspend_user' : 'update_settings',
  details: `Action details for record #${i + 1}`,
  timestamp: new Date(Date.now() - Math.random() * 100000000).toISOString()
}));
