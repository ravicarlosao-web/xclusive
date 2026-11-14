/**
 * Sessão expirada no painel: o access token do admin dura 15 minutos (a sessão local, 4 h). Quando um pedido a /api/admin/* responde 401,
 * apaga a sessão local e vai para o login, UMA só vez e só se ainda não estiver lá (sem loop). Um único ponto cobre todos os pedidos
 * (adminFetch e os fetch diretos das páginas). O próprio login (/api/admin/auth/login) fica de fora: palavra-passe errada continua a ser erro.
 */
const LOGIN_API = '/api/admin/auth/login';

const CODIGO_TROCA = 'troca_password_obrigatoria';

export function instalarSessaoExpirada(): void {
  const original = window.fetch.bind(window);
  let aSair = false;
  let aTrocar = false;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await original(input, init);
    if ((res.status === 401 || res.status === 403) && !aSair && !aTrocar) {
      let caminho = '';
      try {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        caminho = new URL(url, window.location.href).pathname;
      } catch { /* URL ilegível: não é um pedido do painel */ }
      const doPainel = /^\/api\/admin(\/|$)/.test(caminho) && caminho !== LOGIN_API;
      if (doPainel && res.status === 401) {
        aSair = true;
        localStorage.removeItem('admin_token');
        localStorage.removeItem('admin_user');
        localStorage.removeItem('admin_login_time');
        if (!window.location.pathname.endsWith('/login')) window.location.href = import.meta.env.BASE_URL + 'login';
      } else if (doPainel && res.status === 403) {
        // O servidor só aceita a troca de palavra-passe enquanto a marca estiver ativa: marca a sessão local e leva o admin ao formulário (uma só vez).
        const corpo = await res.clone().json().catch(() => null);
        if (corpo?.codigo === CODIGO_TROCA) {
          aTrocar = true;
          try {
            const u = JSON.parse(localStorage.getItem('admin_user') || 'null');
            if (u) localStorage.setItem('admin_user', JSON.stringify({ ...u, trocaPasswordObrigatoria: true }));
          } catch { /* sessão local ilegível: o formulário abre na mesma pelo reload */ }
          window.location.href = import.meta.env.BASE_URL + 'trocar-password';
        }
      }
    }
    return res;
  };
}
