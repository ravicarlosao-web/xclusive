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

  sendBroadcast: (data: any) =>
    adminFetch('/admin/broadcast', { method: 'POST', body: JSON.stringify(data) }),
  getBroadcastHistory: () => adminFetch('/admin/broadcast/history'),

  getSettings: () => adminFetch('/admin/settings'),
  updateSettings: (data: any) =>
    adminFetch('/admin/settings', { method: 'PATCH', body: JSON.stringify(data) }),

  getAuditLog: (params?: Record<string, string>) =>
    adminFetch('/admin/audit-log?' + new URLSearchParams(params)),
};
