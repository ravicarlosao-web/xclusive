const API_BASE = '/api';

async function adminFetch(path: string, options?: RequestInit) {
  const token = localStorage.getItem('admin_token');
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return await res.json();
}

/** Como adminFetch, mas o erro traz a mensagem do servidor ({ error }) em vez do JSON em bruto (409 legíveis). */
async function adminFetchMsg(path: string, options?: RequestInit) {
  const token = localStorage.getItem('admin_token');
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...options?.headers,
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(json?.error || `HTTP ${res.status}`) as Error & { status?: number };
    e.status = res.status;
    throw e;
  }
  return json;
}

export const adminApi = {
  login: (email: string, password: string) =>
    adminFetch('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  getDashboardKpis: () => adminFetch('/admin/dashboard/kpis'),
  getDashboardCharts: () => adminFetch('/admin/dashboard/charts'),
  getActivityFeed: () => adminFetch('/admin/dashboard/activity-feed'),

  getUsers: (params?: Record<string, string>) =>
    adminFetch('/admin/users?' + new URLSearchParams(params)),
  getUser: (id: number) => adminFetch('/admin/users/' + id),
  updateUser: (id: number, data: any) =>
    adminFetch('/admin/users/' + id, { method: 'PATCH', body: JSON.stringify(data) }),
  updateUserStatus: (id: number, estado: string) =>
    adminFetch('/admin/users/' + id + '/status', { method: 'PATCH', body: JSON.stringify({ estado }) }),
  updateUserRole: (id: number, role: string) =>
    adminFetch('/admin/users/' + id + '/role', { method: 'PATCH', body: JSON.stringify({ role }) }),
  deleteUser: (id: number) =>
    adminFetch('/admin/users/' + id, { method: 'DELETE' }),

  getCreators: (params?: Record<string, string>) =>
    adminFetch('/admin/creators?' + new URLSearchParams(params)),
  getKycQueue: () => adminFetch('/admin/creators/kyc-queue'),
  updateKyc: (id: number, data: any) =>
    adminFetch('/admin/creators/' + id + '/kyc', { method: 'PATCH', body: JSON.stringify(data) }),
  // Documentos KYC: pede ao backend o URL assinado (60 s); cada pedido fica no audit_log.
  // Só aceita caminhos do próprio backend (o token de admin nunca vai para outro destino).
  getKycDocumentUrl: (apiPath: string): Promise<{ url: string; expiraEm: string }> => {
    if (!/^\/api\/admin\/kyc\/\d+\/(documento|selfie|liveness)$/.test(apiPath)) {
      return Promise.reject(new Error('Caminho inválido'));
    }
    return adminFetch(apiPath.slice(API_BASE.length));
  },
  // Registos antigos: o proxy /api/admin/media exige o token de admin, por isso é pedido como blob.
  getAdminMediaBlob: async (apiPath: string): Promise<Blob> => {
    if (!apiPath.startsWith('/api/admin/media?')) throw new Error('Caminho inválido');
    const token = localStorage.getItem('admin_token');
    const res = await fetch(apiPath, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  },
  getCreatorPlans: (id: number) => adminFetch('/admin/creators/' + id + '/plans'),
  adjustBalance: (id: number, data: any) =>
    adminFetch('/admin/creators/' + id + '/balance-adjustment', { method: 'POST', body: JSON.stringify(data) }),

  getPosts: (params?: Record<string, string>) =>
    adminFetch('/admin/posts?' + new URLSearchParams(params)),
  deletePost: (id: number, motivo: string) =>
    adminFetch('/admin/posts/' + id, { method: 'DELETE', body: JSON.stringify({ motivo }) }),

  getReports: (params?: Record<string, string>) =>
    adminFetch('/admin/reports?' + new URLSearchParams(params)),
  updateReport: (id: number, data: any) =>
    adminFetch('/admin/reports/' + id, { method: 'PATCH', body: JSON.stringify(data) }),

  // Conteúdo +18 e infrações (rotas do PR A)
  marcarMais18: (tipo: string, id: number, data: { mais18: boolean; infracao?: boolean; motivo?: string }) =>
    adminFetchMsg(`/admin/content/${tipo}/${id}/mais18`, { method: 'POST', body: JSON.stringify(data) }),
  getInfracoesMais18: (userId: number) => adminFetchMsg(`/admin/users/${userId}/infracoes`),
  anularInfracaoMais18: (id: number, motivo: string) =>
    adminFetchMsg(`/admin/infracoes/${id}/anular`, { method: 'POST', body: JSON.stringify({ motivo }) }),

  getFinanceKpis: () => adminFetch('/admin/finance/kpis'),
  getTransactions: (params?: Record<string, string>) =>
    adminFetch('/admin/finance/transactions?' + new URLSearchParams(params)),
  exportTransactions: async () => {
    const token = localStorage.getItem('admin_token');
    const res = await fetch(API_BASE + '/admin/finance/transactions/export', {
      headers: token ? { Authorization: 'Bearer ' + token } : {},
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  },

  getWithdrawals: (params?: Record<string, string>) =>
    adminFetch('/admin/withdrawals?' + new URLSearchParams(params)),
  updateWithdrawal: (id: number, data: any) =>
    adminFetch('/admin/withdrawals/' + id, { method: 'PATCH', body: JSON.stringify(data) }),

  getTopups: (params?: Record<string, string>) =>
    adminFetch('/admin/topups?' + new URLSearchParams(params)),
  updateTopup: (id: number, data: { status: 'aprovado' | 'rejeitado'; notas?: string }) =>
    adminFetch('/admin/topups/' + id, { method: 'PATCH', body: JSON.stringify(data) }),

  sendBroadcast: (data: any) =>
    adminFetch('/admin/broadcast', { method: 'POST', body: JSON.stringify(data) }),
  getBroadcastHistory: () => adminFetch('/admin/broadcast/history'),

  getSettings: () => adminFetch('/admin/settings'),
  updateSettings: (data: any) =>
    adminFetch('/admin/settings', { method: 'PATCH', body: JSON.stringify(data) }),

  getCommissionOverview: () => adminFetch('/admin/users/commission-overview'),
  setCreatorCommission: (id: number, comissaoPersonalizada: number | null) =>
    adminFetch('/admin/users/' + id + '/commission', {
      method: 'PATCH',
      body: JSON.stringify({ comissaoPersonalizada }),
    }),

  getAuditLog: (params?: Record<string, string>) =>
    adminFetch('/admin/audit-log?' + new URLSearchParams(params)),
};
