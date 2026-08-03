/**
 * Signed media URLs para documentos sensíveis (KYC, dados bancários, etc.)
 *
 * Fluxo:
 *   1. O endpoint admin chama signMediaUrl(rawUrl) → devolve /api/admin/media?...
 *   2. O cliente (painel admin autenticado) carrega esse URL
 *   3. GET /api/admin/media verifica requireAdmin + assinatura HMAC + TTL
 *   4. Se válido, redireciona 302 para o rawUrl (CDN/object-storage)
 *
 * Desta forma, mesmo que alguém extraia o rawUrl do redirect, só o consegue
 * obter se tiver um token admin válido — e a assinatura expira em TTL_SECONDS.
 */

import crypto from "crypto";

const SECRET = process.env.SESSION_SECRET;
if (!SECRET) throw new Error("SESSION_SECRET is required for media signing");

/** Duração de validade de cada URL assinado (15 minutos) */
const TTL_SECONDS = 15 * 60;

/**
 * Gera um URL assinado que aponta para GET /api/admin/media.
 * O rawUrl é codificado em base64url para evitar problemas de encoding nos query params.
 */
export function signMediaUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;

  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const encoded = Buffer.from(rawUrl, "utf8").toString("base64url");
  const payload = `${encoded}|${exp}`;
  const sig = crypto.createHmac("sha256", SECRET as string).update(payload).digest("hex");

  return `/api/admin/media?url=${encoded}&exp=${exp}&sig=${sig}`;
}

/**
 * Verifica a assinatura e o TTL. Devolve o rawUrl original ou null se inválido.
 */
export function verifyMediaUrl(
  encoded: string,
  exp: string,
  sig: string,
): string | null {
  // Validação básica de formato
  if (!encoded || !exp || !sig || !/^\d+$/.test(exp) || !/^[0-9a-f]{64}$/.test(sig)) {
    return null;
  }

  // Verificar expiração primeiro (evita HMAC desnecessário)
  const now = Math.floor(Date.now() / 1000);
  if (parseInt(exp, 10) < now) return null;

  // Verificar assinatura com comparação em tempo constante
  const payload = `${encoded}|${exp}`;
  const expected = crypto.createHmac("sha256", SECRET as string).update(payload).digest("hex");
  const sigBuf = Buffer.from(sig, "hex");
  const expBuf = Buffer.from(expected, "hex");

  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;

  try {
    return Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }
}
