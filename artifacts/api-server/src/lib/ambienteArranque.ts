/**
 * Validação das variáveis de ambiente no arranque da API.
 *
 * Em produção (NODE_ENV=production) a API recusa arrancar sem as variáveis obrigatórias. Fora de produção só bloqueiam as regras do Google.
 * As mensagens dizem apenas o NOME da variável e o motivo; nunca o valor.
 */

import { CLIENT_ID_RE, urlLoopback } from "./googleIdToken";

export const BAN_HASH_PEPPER_MIN = 32;

type Ambiente = Record<string, string | undefined>;

/**
 * Lista de erros (vazia = pode arrancar). As obrigatórias só se validam em produção; as regras do login com o Google valem sempre:
 *  - GOOGLE_JWKS_URL (chaves de teste) NUNCA em produção; fora dela, só em loopback;
 *  - GOOGLE_CLIENT_ID, se definido, tem de ter a forma `<número>-<texto>.apps.googleusercontent.com`.
 */
export function errosAmbienteArranque(env: Ambiente): string[] {
  const erros: string[] = [];
  const jwks = env.GOOGLE_JWKS_URL?.trim();
  if (jwks) {
    if (env.NODE_ENV === "production") erros.push("GOOGLE_JWKS_URL não pode estar definida em produção (é só para testes locais).");
    else if (!urlLoopback(jwks)) erros.push("GOOGLE_JWKS_URL inválida: só é aceite um endereço de loopback (localhost, 127.0.0.1 ou [::1]).");
  }
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  if (clientId && !CLIENT_ID_RE.test(clientId)) erros.push("GOOGLE_CLIENT_ID inválida (esperado <número>-<texto>.apps.googleusercontent.com).");
  if (env.NODE_ENV !== "production") return erros;
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
