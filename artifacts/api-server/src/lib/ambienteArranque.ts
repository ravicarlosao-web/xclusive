/**
 * Validação das variáveis de ambiente no arranque da API.
 *
 * Em produção (NODE_ENV=production) a API recusa arrancar sem as variáveis obrigatórias. Fora de produção nada bloqueia.
 * As mensagens dizem apenas o NOME da variável e o motivo; nunca o valor.
 */

export const BAN_HASH_PEPPER_MIN = 32;

type Ambiente = Record<string, string | undefined>;

/** Lista de erros (vazia = pode arrancar). Só valida em produção. */
export function errosAmbienteArranque(env: Ambiente): string[] {
  if (env.NODE_ENV !== "production") return [];
  const erros: string[] = [];
  const pepper = env.BAN_HASH_PEPPER?.trim() ?? "";
  if (!pepper) {
    erros.push("BAN_HASH_PEPPER em falta (obrigatória em produção).");
  } else if (pepper.length < BAN_HASH_PEPPER_MIN) {
    erros.push(`BAN_HASH_PEPPER inválida: tem de ter pelo menos ${BAN_HASH_PEPPER_MIN} caracteres.`);
  }
  return erros;
}

/**
 * Se o ambiente for inválido, escreve os erros no stderr (síncrono, para não se perderem) e termina com código 1.
 * `sair` e `escrever` são injetáveis só para os testes.
 */
export function garantirAmbienteArranque(
  env: Ambiente = process.env,
  sair: (codigo: number) => never = (codigo) => process.exit(codigo),
  escrever: (texto: string) => void = (texto) => { process.stderr.write(texto); },
): void {
  const erros = errosAmbienteArranque(env);
  if (erros.length === 0) return;
  escrever(
    `[arranque] A API não pode arrancar em produção. Variáveis de ambiente inválidas:\n${erros.map((e) => `  - ${e}`).join("\n")}\n`,
  );
  sair(1);
}
