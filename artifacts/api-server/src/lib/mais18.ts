/**
 * Preferência de conteúdo +18 (PR 1: só guarda a escolha; nada é filtrado ainda).
 */

/** Versão do texto do cartão mostrado ao utilizador. Sobe quando o texto mudar; fica em user_mais18_choices. */
export const MAIS18_TEXTO_VERSAO = "1";

export const PREFERENCIAS_MAIS18 = ["ver", "filtrar"] as const;
export type PreferenciaMais18 = typeof PREFERENCIAS_MAIS18[number];

/** Idade mínima para escolher "ver". */
export const IDADE_MINIMA_VER = 18;

/**
 * Idade em anos completos a partir da data de nascimento "AAAA-MM-DD" (UTC, só dia/mês/ano).
 * Devolve null se a data faltar, for inválida ou estiver no futuro (idade não verificável).
 */
export function idadeEmAnos(dataNascimento: string | null | undefined, agora: Date = new Date()): number | null {
  if (!dataNascimento) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dataNascimento);
  if (!m) return null;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  const hojeAno = agora.getUTCFullYear(), hojeMes = agora.getUTCMonth() + 1, hojeDia = agora.getUTCDate();
  if (ano > hojeAno || (ano === hojeAno && (mes > hojeMes || (mes === hojeMes && dia > hojeDia)))) return null;
  let idade = hojeAno - ano;
  if (hojeMes < mes || (hojeMes === mes && hojeDia < dia)) idade -= 1;
  return idade;
}
