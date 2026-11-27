/**
 * Política de indexação do site PÚBLICO (uma única fonte de verdade, usada por <RobotsMeta /> e pelos testes).
 * Só estas páginas são indexáveis: a inicial e as páginas legais públicas. TODO o resto (perfis, feed, mensagens, carteira,
 * definições, lives, login/registo, rotas autenticadas, páginas desconhecidas) é «noindex, nofollow». Por omissão fecha: uma rota nova
 * nunca fica indexável sem ser acrescentada aqui de propósito.
 * O painel de admin tem o seu próprio index.html e os seus cabeçalhos; nada aqui lhe diz respeito.
 */
export const ROBOTS_INDEXAVEL = 'index, follow';
export const ROBOTS_PRIVADO = 'noindex, nofollow';

/** Páginas legais públicas (sem login). */
export const PAGINAS_LEGAIS = ['/termos', '/privacidade', '/cookies', '/politica-de-conteudo', '/direitos-de-autor', '/reembolsos', '/termos-criadoras', '/modelo-consentimento'] as const;
export const PAGINAS_INDEXAVEIS: readonly string[] = ['/', ...PAGINAS_LEGAIS];

/** Valor do <meta name="robots"> para um caminho (sem base, sem query nem #); uma barra final é ignorada. */
export function politicaRobots(caminho: string): string {
  const p = (caminho.split(/[?#]/)[0] || '/').replace(/\/+$/, '') || '/';
  return PAGINAS_INDEXAVEIS.includes(p) ? ROBOTS_INDEXAVEL : ROBOTS_PRIVADO;
}

/** Endereço canónico do site (a página inicial é o ecrã de login). */
export const CANONICO_INICIAL = 'https://xclusive.ao/';

/** <link rel="canonical"> de um caminho: só a página inicial tem; as outras rotas não (null). */
export function canonicoDe(caminho: string): string | null {
  const p = (caminho.split(/[?#]/)[0] || '/').replace(/\/+$/, '') || '/';
  return p === '/' ? CANONICO_INICIAL : null;
}
