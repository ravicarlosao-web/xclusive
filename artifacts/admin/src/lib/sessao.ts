/**
 * Sessão expirada no painel: o access token do admin dura 15 minutos (a sessão local, 4 h). Quando um pedido a /api/admin/* responde 401,
 * apaga a sessão local e vai para o login, UMA só vez e só se ainda não estiver lá (sem loop). Um único ponto cobre todos os pedidos
 * (adminFetch e os fetch diretos das páginas). O próprio login (/api/admin/auth/login) fica de fora: palavra-passe errada continua a ser erro.
 */
const LOGIN_API = '/api/admin/auth/login';
/** O 2.º passo do login também fica de fora: um código errado é um erro de formulário, não uma sessão expirada. */
const LOGIN_TOTP_API = '/api/admin/auth/login/totp';
/**
 * Pedidos de TOTP/reposição com credenciais: um 401 com «Palavra-passe incorreta.» ou «Código inválido…» é um erro de formulário, NÃO uma sessão expirada.
 * Só conta como sessão terminada se o servidor o disser (codigo «sessao_terminada») ou se faltar/for inválido o token.
 */
const TOTP_API = /^\/api\/admin\/(totp\/|administradores\/\d+\/totp\/)/;
const SESSAO_TERMINADA_MSG = /^(Token inválido|Não autenticado)$/;

const CODIGO_TROCA = 'troca_password_obrigatoria';
const CODIGO_ATIVACAO_TOTP = 'ativacao_totp_obrigatoria';

export function instalarSessaoExpirada(): void {
  const original = window.fetch.bind(window);
  let aSair = false;
  let aTrocar = false;
  let aAtivar = false;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await original(input, init);
    if ((res.status === 401 || res.status === 403) && !aSair && !aTrocar && !aAtivar) {
      let caminho = '';
      try {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        caminho = new URL(url, window.location.href).pathname;
      } catch { /* URL ilegível: não é um pedido do painel */ }
      let doPainel = /^\/api\/admin(\/|$)/.test(caminho) && caminho !== LOGIN_API && caminho !== LOGIN_TOTP_API;
      if (doPainel && res.status === 401 && TOTP_API.test(caminho)) {
        const corpo = await res.clone().json().catch(() => null);
        if (!(corpo?.codigo === 'sessao_terminada' || SESSAO_TERMINADA_MSG.test(String(corpo?.error ?? '')))) doPainel = false;   // erro de formulário (palavra-passe/código errados)
      }
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
          if (!window.location.pathname.endsWith('/trocar-password')) window.location.href = import.meta.env.BASE_URL + 'trocar-password';   // já no formulário: não recarrega (sem ciclo)
        } else if (corpo?.codigo === CODIGO_ATIVACAO_TOTP) {
          // Modo obrigatório: sem TOTP, a sessão só serve para o ativar. Marca a sessão local e leva o admin à página de ativação (uma só vez, sem ciclo).
          aAtivar = true;
          try {
            const u = JSON.parse(localStorage.getItem('admin_user') || 'null');
            if (u) localStorage.setItem('admin_user', JSON.stringify({ ...u, totpAtivacaoNecessaria: true }));
          } catch { /* sessão local ilegível: a página abre na mesma pelo reload */ }
          if (!window.location.pathname.endsWith('/seguranca')) window.location.href = import.meta.env.BASE_URL + 'seguranca';
        }
      }
    }
    return res;
  };
}
