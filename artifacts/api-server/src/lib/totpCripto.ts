/**
 * Cifra do segredo TOTP em repouso: AES-256-GCM, IV aleatório (12 bytes) por segredo, autenticação (tag de 16 bytes) verificada ao decifrar.
 *
 *  - A chave vem de ADMIN_TOTP_CHAVE (32 bytes em base64). NUNCA é commitada, escrita em lado nenhum nem registada. Se faltar ou for inválida, o servidor arranca na mesma
 *    (aviso no arranque, sem o valor) e todas as operações de TOTP respondem 503 sem detalhes (TotpIndisponivelError); as contas SEM TOTP continuam a entrar.
 *  - Cada valor guardado leva o identificador da versão da chave («v1»): só o formato, para permitir rodar a chave no futuro (a rotação não está implementada: só há a v1).
 *  - Dados autenticados adicionais (AAD): versão + id da conta. Um segredo cifrado copiado para outra conta (ou com outra versão) deixa de decifrar.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const VERSAO_CHAVE_ATUAL = "v1";
const ALGORITMO = "aes-256-gcm";
const TAMANHO_IV = 12;
const TAMANHO_TAG = 16;

/** O TOTP não está disponível (chave em falta/inválida, tabelas por criar…). Nunca leva detalhes: o chamador responde 503 genérico. */
export class TotpIndisponivelError extends Error {
  constructor() { super("totp_indisponivel"); this.name = "TotpIndisponivelError"; }
}
/** O valor guardado não decifra (adulterado, chave errada, versão desconhecida, outra conta). Sem detalhes. */
export class TotpCifraError extends Error {
  constructor() { super("totp_cifra"); this.name = "TotpCifraError"; }
}

export interface SegredoCifrado { segredoCifrado: string; iv: string; tag: string; chaveVersao: string }

type Ambiente = Record<string, string | undefined>;

/** A chave de 32 bytes, ou null se ADMIN_TOTP_CHAVE faltar ou não for base64 de exatamente 32 bytes. */
export function lerChaveTotp(env: Ambiente = process.env): Buffer | null {
  const bruto = env.ADMIN_TOTP_CHAVE?.trim();
  if (!bruto || !/^[A-Za-z0-9+/]+={0,2}$/.test(bruto)) return null;
  const chave = Buffer.from(bruto, "base64");
  return chave.length === 32 ? chave : null;
}

export const totpDisponivel = (env: Ambiente = process.env): boolean => lerChaveTotp(env) !== null;

/** Motivo (sem o valor) para o aviso do arranque; null = tudo bem. */
export function avisoChaveTotp(env: Ambiente = process.env): string | null {
  const bruto = env.ADMIN_TOTP_CHAVE?.trim();
  if (!bruto) return "ADMIN_TOTP_CHAVE não está definida: o TOTP dos admins fica indisponível (as rotas de TOTP respondem 503; as contas sem TOTP entram normalmente).";
  if (lerChaveTotp(env) === null) return "ADMIN_TOTP_CHAVE é inválida (tem de ser base64 de exatamente 32 bytes): o TOTP dos admins fica indisponível (as rotas de TOTP respondem 503; as contas sem TOTP entram normalmente).";
  return null;
}

const aad = (versao: string, userId: number): Buffer => Buffer.from(`xclusive-admin-totp|${versao}|${userId}`, "utf8");

export function cifrarSegredo(segredo: string, userId: number, chave: Buffer | null = lerChaveTotp()): SegredoCifrado {
  if (!chave) throw new TotpIndisponivelError();
  const iv = randomBytes(TAMANHO_IV);
  const cifra = createCipheriv(ALGORITMO, chave, iv, { authTagLength: TAMANHO_TAG });
  cifra.setAAD(aad(VERSAO_CHAVE_ATUAL, userId));
  const cifrado = Buffer.concat([cifra.update(segredo, "utf8"), cifra.final()]);
  return { segredoCifrado: cifrado.toString("base64"), iv: iv.toString("base64"), tag: cifra.getAuthTag().toString("base64"), chaveVersao: VERSAO_CHAVE_ATUAL };
}

export function decifrarSegredo(c: SegredoCifrado, userId: number, chave: Buffer | null = lerChaveTotp()): string {
  if (!chave) throw new TotpIndisponivelError();
  if (c.chaveVersao !== VERSAO_CHAVE_ATUAL) throw new TotpCifraError();
  try {
    const iv = Buffer.from(c.iv, "base64"), tag = Buffer.from(c.tag, "base64");
    if (iv.length !== TAMANHO_IV || tag.length !== TAMANHO_TAG) throw new TotpCifraError();
    const decifra = createDecipheriv(ALGORITMO, chave, iv, { authTagLength: TAMANHO_TAG });
    decifra.setAAD(aad(c.chaveVersao, userId));
    decifra.setAuthTag(tag);
    return Buffer.concat([decifra.update(Buffer.from(c.segredoCifrado, "base64")), decifra.final()]).toString("utf8");   // final() lança se a tag não bater
  } catch {
    throw new TotpCifraError();
  }
}
