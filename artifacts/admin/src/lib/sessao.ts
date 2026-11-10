/**
 * Sessão expirada no painel: o access token do admin dura 15 minutos (a sessão local, 4 h). Quando um pedido a /api/admin/* responde 401,
 * apaga a sessão local e vai para o login, UMA só vez e só se ainda não estiver lá (sem loop). Um único ponto cobre todos os pedidos
 * (adminFetch e os fetch diretos das páginas). O próprio login (/api/admin/auth/login) fica de fora: palavra-passe errada continua a ser erro.
 */
const LOGIN_API = '/api/admin/auth/login';

export function instalarSessaoExpirada(): void {
  const original = window.fetch.bind(window);
  let aSair = false;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await original(input, init);
    if (res.status === 401 && !aSair) {
      let caminho = '';
      try {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        caminho = new URL(url, window.location.href).pathname;
      } catch { /* URL ilegível: não é um pedido do painel */ }
      if (/^\/api\/admin(\/|$)/.test(caminho) && caminho !== LOGIN_API) {
        aSair = true;
        localStorage.removeItem('admin_token');
        localStorage.removeItem('admin_user');
        localStorage.removeItem('admin_login_time');
        if (!window.location.pathname.endsWith('/login')) window.location.href = import.meta.env.BASE_URL + 'login';
      }
    }
    return res;
  };
}
