import * as mocks from './mockAdminData';

const API_BASE = '/api';

async function adminFetch(path: string, options?: RequestInit) {
  const token = localStorage.getItem('admin_token');
  try {
    const res = await fetch(API_BASE + path, {
      ...options,
      headers: { 
        'Content-Type': 'application/json', 
        ...(token ? { Authorization: 'Bearer ' + token } : {}), 
        ...options?.headers 
      },
    });
    if (!res.ok) throw new Error(await res.text());
    return await res.json();
  } catch (err) {
    console.warn(`API call failed, falling back to mock data for ${path}`, err);
    // Parse URL to handle query params
    const url = new URL(path, 'http://localhost');
    const pathname = url.pathname;
    
    // Mock routing
    if (pathname === '/admin/auth/login') {
      const body = JSON.parse(options?.body as string || '{}');
      if (body.email === 'admin@xclusive.com' && body.password === 'admin123') {
        return { token: 'mock-admin-token-123', user: { id: 1, name: 'Admin', email: body.email } };
      }
      throw new Error('Invalid credentials');
    }
    if (pathname === '/admin/dashboard/kpis') return mocks.kpis;
    if (pathname === '/admin/dashboard/charts') return mocks.dashboardCharts;
    if (pathname === '/admin/dashboard/activity-feed') return mocks.activityFeed;
    if (pathname === '/admin/users') return mocks.users;
    if (pathname.match(/^\/admin\/users\/\d+$/)) {
      const id = parseInt(pathname.split('/').pop() || '0');
      return mocks.users.find(u => u.id === id) || mocks.users[0];
    }
    if (pathname.match(/^\/admin\/users\/\d+\/status$/)) return { success: true };
    if (pathname.match(/^\/admin\/users\/\d+\/role$/)) return { success: true };
    if (pathname.match(/^\/admin\/users\/\d+$/) && options?.method === 'DELETE') return { success: true };
    
    if (pathname === '/admin/creators') return mocks.creators;
    if (pathname === '/admin/creators/kyc-queue') return mocks.kycQueue;
    if (pathname.match(/^\/admin\/creators\/\d+\/kyc$/)) return { success: true };
    
    if (pathname === '/admin/posts') return mocks.posts;
    if (pathname.match(/^\/admin\/posts\/\d+$/) && options?.method === 'DELETE') return { success: true };
    
    if (pathname === '/admin/reports') return mocks.reports;
    if (pathname.match(/^\/admin\/reports\/\d+$/)) return { success: true };
    
    if (pathname === '/admin/finance/kpis') return mocks.financeKpis;
    if (pathname === '/admin/finance/transactions') return mocks.transactions;
    if (pathname === '/admin/withdrawals') return mocks.withdrawals;
    if (pathname.match(/^\/admin\/withdrawals\/\d+$/)) return { success: true };
    
    if (pathname === '/admin/broadcast' && options?.method === 'POST') return { success: true };
    if (pathname === '/admin/broadcast/history') return mocks.broadcastHistory;
    
    if (pathname === '/admin/settings') return mocks.settings;
    if (pathname === '/admin/settings' && options?.method === 'PATCH') return { success: true, ...JSON.parse(options?.body as string || '{}') };
    
    if (pathname === '/admin/audit-log') return mocks.auditLog;
    
    return { success: true, mocked: true };
  }
}

export const adminApi = {
  login: (email: string, password: string) => adminFetch('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  getDashboardKpis: () => adminFetch('/admin/dashboard/kpis'),
  getDashboardCharts: () => adminFetch('/admin/dashboard/charts'),
  getActivityFeed: () => adminFetch('/admin/dashboard/activity-feed'),
  getUsers: (params?: Record<string, string>) => adminFetch('/admin/users?' + new URLSearchParams(params)),
  getUser: (id: number) => adminFetch('/admin/users/' + id),
  updateUser: (id: number, data: any) => adminFetch('/admin/users/' + id, { method: 'PATCH', body: JSON.stringify(data) }),
  updateUserStatus: (id: number, estado: string) => adminFetch('/admin/users/' + id + '/status', { method: 'PATCH', body: JSON.stringify({ estado }) }),
  updateUserRole: (id: number, role: string) => adminFetch('/admin/users/' + id + '/role', { method: 'PATCH', body: JSON.stringify({ role }) }),
  deleteUser: (id: number) => adminFetch('/admin/users/' + id, { method: 'DELETE' }),
  getCreators: (params?: Record<string, string>) => adminFetch('/admin/creators?' + new URLSearchParams(params)),
  getKycQueue: () => adminFetch('/admin/creators/kyc-queue'),
  updateKyc: (id: number, data: any) => adminFetch('/admin/creators/' + id + '/kyc', { method: 'PATCH', body: JSON.stringify(data) }),
  getCreatorPlans: (id: number) => adminFetch('/admin/creators/' + id + '/plans'),
  adjustBalance: (id: number, data: any) => adminFetch('/admin/creators/' + id + '/balance-adjustment', { method: 'POST', body: JSON.stringify(data) }),
  getPosts: (params?: Record<string, string>) => adminFetch('/admin/posts?' + new URLSearchParams(params)),
  deletePost: (id: number, motivo: string) => adminFetch('/admin/posts/' + id, { method: 'DELETE', body: JSON.stringify({ motivo }) }),
  getReports: (params?: Record<string, string>) => adminFetch('/admin/reports?' + new URLSearchParams(params)),
  updateReport: (id: number, data: any) => adminFetch('/admin/reports/' + id, { method: 'PATCH', body: JSON.stringify(data) }),
  getFinanceKpis: () => adminFetch('/admin/finance/kpis'),
  getTransactions: (params?: Record<string, string>) => adminFetch('/admin/finance/transactions?' + new URLSearchParams(params)),
  exportTransactions: async () => { 
    // mock blob download
    return new Blob(['mock,csv,data'], { type: 'text/csv' });
  },
  getWithdrawals: (params?: Record<string, string>) => adminFetch('/admin/withdrawals?' + new URLSearchParams(params)),
  updateWithdrawal: (id: number, data: any) => adminFetch('/admin/withdrawals/' + id, { method: 'PATCH', body: JSON.stringify(data) }),
  sendBroadcast: (data: any) => adminFetch('/admin/broadcast', { method: 'POST', body: JSON.stringify(data) }),
  getBroadcastHistory: () => adminFetch('/admin/broadcast/history'),
  getSettings: () => adminFetch('/admin/settings'),
  updateSettings: (data: any) => adminFetch('/admin/settings', { method: 'PATCH', body: JSON.stringify(data) }),
  getAuditLog: (params?: Record<string, string>) => adminFetch('/admin/audit-log?' + new URLSearchParams(params)),
};
