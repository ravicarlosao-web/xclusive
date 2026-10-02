import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { logger } from "./logger";

/** Vida do token de espectador WebRTC (dentro dos 60–120 s acordados). */
export const LIVE_VIEWER_TOKEN_TTL_SECONDS = 90;

const AUDIENCE = "live-viewer";
const MIN_SECRET_LENGTH = 32;
const DEFAULT_WEBRTC_BASE_URL = "wss://live.xclusive.ao";

export interface ViewerTokenClaims {
  /** id do utilizador */
  userId: number;
  /** id da live */
  liveId: number;
  /** streamKey a que o token dá acesso */
  streamKey: string;
  jti: string;
  exp: number;
}

let warnedNotConfigured = false;

/**
 * Lê LIVE_VIEWER_TOKEN_SECRET na hora (nunca no import: sem ele o servidor
 * arranca na mesma). Devolve null se não existir ou for curto (< 32 chars).
 */
function getSecret(): string | null {
  const secret = process.env.LIVE_VIEWER_TOKEN_SECRET;
  if (secret && secret.length >= MIN_SECRET_LENGTH) return secret;
  if (!warnedNotConfigured) {
    warnedNotConfigured = true;
    logger.warn(
      "LIVE_VIEWER_TOKEN_SECRET não definido ou com menos de 32 caracteres — WebRTC de espectadores desativado (o HLS continua a funcionar).",
    );
  }
  return null;
}

export function isViewerTokenConfigured(): boolean {
  return getSecret() !== null;
}

/**
 * Token JWT (HS256) de vida curta, ligado ao utilizador, à live e à streamKey.
 * Sem uso único na v1 (o jti fica nos claims para o permitir mais tarde).
 * Devolve null se o segredo não estiver configurado.
 */
export function signViewerToken(input: {
  userId: number;
  liveId: number;
  streamKey: string;
}): { token: string; expiresAt: Date } | null {
  const secret = getSecret();
  if (!secret) return null;
  const token = jwt.sign({ lid: input.liveId, sk: input.streamKey }, secret, {
    algorithm: "HS256",
    audience: AUDIENCE,
    subject: String(input.userId),
    jwtid: crypto.randomUUID(),
    expiresIn: LIVE_VIEWER_TOKEN_TTL_SECONDS,
  });
  const { exp } = jwt.decode(token) as { exp: number };
  return { token, expiresAt: new Date(exp * 1000) };
}

/** Verifica assinatura, algoritmo, audiência e expiração. null = inválido/expirado/sem segredo. */
export function verifyViewerToken(token: string): ViewerTokenClaims | null {
  const secret = getSecret();
  if (!secret || !token) return null;
  try {
    const p = jwt.verify(token, secret, { algorithms: ["HS256"], audience: AUDIENCE }) as jwt.JwtPayload;
    const userId = Number(p.sub);
    if (
      !Number.isInteger(userId) ||
      userId <= 0 ||
      !Number.isInteger(p.lid) ||
      typeof p.sk !== "string" ||
      typeof p.jti !== "string" ||
      typeof p.exp !== "number"
    ) {
      return null;
    }
    return { userId, liveId: p.lid as number, streamKey: p.sk, jti: p.jti, exp: p.exp };
  } catch {
    return null;
  }
}

/** URL de sinalização WebRTC do espectador: <base>/live/<streamKey>?token=<token> */
export function buildWebrtcViewerUrl(streamKey: string, token: string): string {
  const raw = (process.env.LIVE_WEBRTC_VIEWER_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const base = /^wss?:\/\//i.test(raw) ? raw : DEFAULT_WEBRTC_BASE_URL;
  return `${base}/live/${streamKey}?token=${encodeURIComponent(token)}`;
}
