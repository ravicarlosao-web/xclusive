/**
 * TOTP (RFC 6238) sobre a biblioteca `otpauth` (zero dependências, mantida): SHA-1, 6 dígitos, período de 30 s (Google Authenticator, Microsoft Authenticator, Authy, 1Password),
 * tolerância de ±1 passo. O HMAC NÃO é implementado aqui.
 * Um código é aceite se o seu passo de tempo estiver na janela; quem o consome (lib/adminTotp.ts) só o aceita se o passo for MAIOR que o último usado (anti-repetição).
 */
import { TOTP, Secret } from "otpauth";

export const TOTP_PERIODO_S = 30;
export const TOTP_DIGITOS = 6;
export const TOTP_JANELA = 1;   // ±1 passo (30 s para cada lado)
export const EMISSOR_TOTP = "Xclusive Admin";

const totpDe = (base32: string, etiqueta = "admin") => new TOTP({ issuer: EMISSOR_TOTP, label: etiqueta, algorithm: "SHA1", digits: TOTP_DIGITOS, period: TOTP_PERIODO_S, secret: Secret.fromBase32(base32) });

/** Segredo novo: 20 bytes aleatórios (160 bits, o tamanho do RFC 4226) em base32. */
export function novoSegredoTotp(): string {
  return new Secret({ size: 20 }).base32;
}

/** URI otpauth:// para o código QR / introdução manual. A etiqueta é o nome de utilizador (nunca o email). */
export function uriOtpauth(base32: string, etiqueta: string): string {
  return totpDe(base32, etiqueta).toString();
}

/** Passo de tempo (contador) de um instante em milissegundos. */
export const passoDe = (agoraMs: number): number => Math.floor(agoraMs / 1000 / TOTP_PERIODO_S);

/** Código de 6 dígitos para um instante (usado só pelos testes e pelo auxiliar de teste). */
export function gerarCodigoTotp(base32: string, agoraMs: number = Date.now()): string {
  return totpDe(base32).generate({ timestamp: agoraMs });
}

/** Normaliza o que o utilizador escreveu: só aceita exatamente 6 dígitos (espaços são ignorados). */
export function normalizarCodigoTotp(entrada: unknown): string | null {
  if (typeof entrada !== "string") return null;
  const limpo = entrada.replace(/\s+/g, "");
  return /^\d{6}$/.test(limpo) ? limpo : null;
}

/** O passo de tempo que o código confirma (dentro da janela ±1), ou null se o código não vale. */
export function passoDoCodigo(base32: string, entrada: unknown, agoraMs: number = Date.now()): number | null {
  const codigo = normalizarCodigoTotp(entrada);
  if (!codigo) return null;
  const delta = totpDe(base32).validate({ token: codigo, timestamp: agoraMs, window: TOTP_JANELA });
  return delta === null ? null : passoDe(agoraMs) + delta;
}
