/**
 * Validação de parâmetros de pedido (ids e paginação): valores mal formados dão 400 em vez de rebentarem na base de dados (500).
 */

/** Id inteiro positivo (até 9 dígitos, cabe em `integer`) ou null. */
export function idDe(v: unknown): number | null {
  const s = Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");
  if (!/^\d{1,9}$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

export const PAGINA_MAX = 100_000;
export const MSG_PAGINACAO_INVALIDA = "Parâmetros de paginação inválidos.";

function inteiroOpcional(v: unknown, padrao: number): number | null {
  const bruto = Array.isArray(v) ? v[0] : v;
  if (bruto === undefined || bruto === null || bruto === "") return padrao;
  const s = String(bruto).trim();
  if (!/^-?\d{1,9}$/.test(s)) return null;   // texto, decimais, notação científica ou números gigantes
  return Number(s);
}

/**
 * `page` e `limit` da query: têm de ser inteiros (senão null → 400). Inteiros fora do intervalo normal continuam a ser ajustados
 * (page < 1 → 1; limit < 1 → 1; limit > máximo → máximo). `page` acima de PAGINA_MAX também é recusado (null).
 */
export function paginacaoDe(page: unknown, limit: unknown, limitMax: number, limitPadrao = 10): { page: number; limit: number } | null {
  const p = inteiroOpcional(page, 1), l = inteiroOpcional(limit, limitPadrao);
  if (p === null || l === null || p > PAGINA_MAX) return null;
  return { page: Math.max(1, p), limit: Math.min(limitMax, Math.max(1, l)) };
}
