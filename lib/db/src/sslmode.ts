/**
 * Torna EXPLÍCITO o modo SSL que o pg 8 já aplica hoje.
 *
 * O pg 8 (pg-connection-string 2.x) trata sslmode=prefer, require e verify-ca como se fossem 'verify-full' (certificado verificado,
 * nome do servidor verificado) e avisa que no pg v9 passam a ter a semântica do libpq, mais fraca. Esta função troca, EM MEMÓRIA, esses
 * três valores por 'verify-full' no texto do URL: o comportamento de hoje fica explícito e não muda com a subida do pg.
 *
 * Regras (cada uma tem teste e mutação):
 *  - só substitui o texto do valor do parâmetro sslmode, na parte do URL depois do «?» (nunca reconstrói o URL: palavras-passe e nomes
 *    com caracteres especiais ficam byte a byte iguais);
 *  - não toca em sslmode=disable, no-verify nem verify-full, nem em URLs com uselibpqcompat=true (escolha deliberada pela semântica libpq);
 *  - sem sslmode no URL não toca em nada (continua a valer o ssl do código em index.ts);
 *  - só reconhece os valores exatos, em minúsculas, como o pg;
 *  - nunca escreve nem lança o URL (nem partes dele).
 */
export function sslmodeExplicito(url: string): string {
  if (typeof url !== "string") return url;
  const i = url.indexOf("?");
  if (i < 0) return url;
  if (/(^|[?&])uselibpqcompat=true(?=&|#|$)/.test(url)) return url;
  const novo = url.slice(i + 1).replace(/(^|&)(sslmode=)(prefer|require|verify-ca)(?=&|#|$)/g, "$1$2verify-full");
  return url.slice(0, i + 1) + novo;
}
