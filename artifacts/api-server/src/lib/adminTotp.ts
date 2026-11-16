/**
 * Serviço do TOTP dos admins (A4a): ativação, verificação do 2.º passo, códigos de recuperação, desativação e reposição. Só servidor.
 *
 *  - O segredo só existe em texto simples na memória, durante uma operação (e, UMA vez, na resposta de «iniciar»); em repouso está cifrado (lib/totpCripto.ts).
 *  - Anti-repetição: um código só vale se o seu passo de tempo for MAIOR que `ultimo_passo_usado`; a atualização é atómica (UPDATE … WHERE ultimo_passo_usado < passo).
 *  - «Tabela em falta» (a migração ainda não foi aplicada) conta como «sem TOTP» ao decidir se uma sessão precisa do 2.º passo (uma conta não pode ter TOTP sem a tabela),
 *    mas as operações de TOTP respondem 503 (TotpIndisponivelError).
 *  - Códigos de recuperação: 10 por conta, formato XXXXX-XXXXX, só hash bcrypt (o mesmo das palavras-passe), uso único.
 */
import { randomInt } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, adminTotpTable, adminTotpRecuperacaoTable, platformSettingsTable } from "@workspace/db";
import { hashPassword, comparePassword } from "./auth.js";
import { cifrarSegredo, decifrarSegredo, lerChaveTotp, TotpIndisponivelError } from "./totpCripto.js";
import { novoSegredoTotp, uriOtpauth, passoDoCodigo } from "./totp.js";

export const TOTP_OBRIGATORIO_KEY = "admin_totp_obrigatorio";
export const PENDENTE_MINUTOS = 10;
export const CODIGOS_RECUPERACAO = 10;
const ALFABETO_RECUPERACAO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // sem 0, O, 1, I

/** O erro é «a tabela não existe» (migração por aplicar)? */
function tabelaEmFalta(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "42P01" || e?.cause?.code === "42P01";
}
/** Converte «tabela em falta» em TotpIndisponivelError (503 genérico); outros erros passam. */
async function comTabelas<T>(f: () => Promise<T>): Promise<T> {
  try { return await f(); } catch (err) { if (tabelaEmFalta(err)) throw new TotpIndisponivelError(); throw err; }
}

/** A conta tem TOTP ATIVO? (tabela em falta = não). Erros de BD sobem (o chamador nega: fail-closed). */
export async function totpAtivo(userId: number): Promise<boolean> {
  try {
    const [l] = await db.select({ id: adminTotpTable.id }).from(adminTotpTable).where(and(eq(adminTotpTable.userId, userId), sql`${adminTotpTable.ativadoEm} is not null`)).limit(1);
    return !!l;
  } catch (err) {
    if (tabelaEmFalta(err)) return false;
    throw err;
  }
}

/** Modo obrigatório (platform_settings.admin_totp_obrigatorio): só um `true` explícito liga; ausente = desligado. */
export async function totpObrigatorio(): Promise<boolean> {
  const [l] = await db.select({ value: platformSettingsTable.value }).from(platformSettingsTable).where(eq(platformSettingsTable.key, TOTP_OBRIGATORIO_KEY)).limit(1);
  return (l?.value as { value?: unknown } | null | undefined)?.value === true;
}

export interface EstadoTotp { ativo: boolean; pendente: boolean; codigosRestantes: number }
export async function estadoTotp(userId: number): Promise<EstadoTotp> {
  return comTabelas(async () => {
    const [l] = await db.select({ ativadoEm: adminTotpTable.ativadoEm, criadoEm: adminTotpTable.criadoEm }).from(adminTotpTable).where(eq(adminTotpTable.userId, userId)).limit(1);
    const ativo = !!l?.ativadoEm;
    const pendente = !!l && !l.ativadoEm && Date.now() - l.criadoEm.getTime() < PENDENTE_MINUTOS * 60_000;
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(adminTotpRecuperacaoTable).where(and(eq(adminTotpRecuperacaoTable.userId, userId), isNull(adminTotpRecuperacaoTable.usadoEm)));
    return { ativo, pendente, codigosRestantes: ativo ? n : 0 };
  });
}

export class TotpJaAtivoError extends Error { constructor() { super("totp_ja_ativo"); this.name = "TotpJaAtivoError"; } }

/** Inicia a ativação: cria (ou substitui) o segredo PENDENTE (expira em 10 min). Falha se a conta já tem TOTP ativo. O segredo em texto vai UMA vez na resposta. */
export async function iniciarAtivacao(userId: number, username: string): Promise<{ segredo: string; uri: string; expiresIn: number }> {
  if (!lerChaveTotp()) throw new TotpIndisponivelError();
  const segredo = novoSegredoTotp();
  const c = cifrarSegredo(segredo, userId);
  const r = await comTabelas(() => db.execute(sql`
    insert into admin_totp (user_id, segredo_cifrado, iv, tag, chave_versao, criado_em) values (${userId}, ${c.segredoCifrado}, ${c.iv}, ${c.tag}, ${c.chaveVersao}, now())
    on conflict (user_id) do update set segredo_cifrado = excluded.segredo_cifrado, iv = excluded.iv, tag = excluded.tag, chave_versao = excluded.chave_versao, criado_em = now(), ultimo_passo_usado = null
      where admin_totp.ativado_em is null
    returning id`));
  if (r.rows.length !== 1) throw new TotpJaAtivoError();
  return { segredo, uri: uriOtpauth(segredo, username), expiresIn: PENDENTE_MINUTOS * 60 };
}

/** Gera 10 códigos de recuperação e os hashes (bcrypt, o mesmo das palavras-passe). */
export async function gerarCodigosRecuperacao(): Promise<{ codigos: string[]; hashes: string[] }> {
  const codigos = Array.from({ length: CODIGOS_RECUPERACAO }, () => {
    const c = Array.from({ length: 10 }, () => ALFABETO_RECUPERACAO[randomInt(ALFABETO_RECUPERACAO.length)]).join("");
    return `${c.slice(0, 5)}-${c.slice(5)}`;
  });
  const hashes: string[] = [];
  for (const c of codigos) hashes.push(await hashPassword(normalizarRecuperacao(c)!));
  return { codigos, hashes };
}

/** «ab cd-efghi jk» → «ABCDEFGHIJK»: maiúsculas, sem espaços nem hífenes; null se não tiver 10 caracteres do alfabeto. */
export function normalizarRecuperacao(entrada: unknown): string | null {
  if (typeof entrada !== "string") return null;
  const c = entrada.toUpperCase().replace(/[\s-]/g, "");
  return c.length === 10 && [...c].every((x) => ALFABETO_RECUPERACAO.includes(x)) ? c : null;
}

export type ResultadoConfirmar = { ok: true; codigos: string[] } | { ok: false; motivo: "sem_pendente" | "expirado" | "codigo_invalido" };

/** Confirma a ativação com um código válido: só então o TOTP fica ativo e se geram (e devolvem, UMA vez) os 10 códigos de recuperação. */
export async function confirmarAtivacao(userId: number, codigo: unknown, agoraMs: number = Date.now()): Promise<ResultadoConfirmar> {
  const chave = lerChaveTotp(); if (!chave) throw new TotpIndisponivelError();
  const [l] = await comTabelas(() => db.select().from(adminTotpTable).where(eq(adminTotpTable.userId, userId)).limit(1));
  if (!l || l.ativadoEm) return { ok: false, motivo: "sem_pendente" };
  if (agoraMs - l.criadoEm.getTime() >= PENDENTE_MINUTOS * 60_000) { await db.delete(adminTotpTable).where(and(eq(adminTotpTable.id, l.id), isNull(adminTotpTable.ativadoEm))); return { ok: false, motivo: "expirado" }; }
  const passo = passoDoCodigo(decifrarSegredo(l, userId, chave), codigo, agoraMs);
  if (passo === null) return { ok: false, motivo: "codigo_invalido" };
  const { codigos, hashes } = await gerarCodigosRecuperacao();
  const ok = await db.transaction(async (tx) => {
    const r = await tx.execute(sql`update admin_totp set ativado_em = now(), ultimo_passo_usado = ${passo} where id = ${l.id} and ativado_em is null and criado_em > now() - make_interval(mins => ${PENDENTE_MINUTOS}) returning id`);
    if (r.rows.length !== 1) return false;
    await tx.delete(adminTotpRecuperacaoTable).where(eq(adminTotpRecuperacaoTable.userId, userId));
    await tx.insert(adminTotpRecuperacaoTable).values(hashes.map((h) => ({ userId, codigoHash: h })));
    return true;
  });
  return ok ? { ok: true, codigos } : { ok: false, motivo: "expirado" };
}

export type ResultadoSegundoPasso = { ok: true; via: "totp" | "recuperacao"; restantes?: number } | { ok: false };

/**
 * Verifica o 2.º passo: um código TOTP (passo MAIOR que o último usado, janela ±1) OU um código de recuperação (uso único).
 * A mensagem de erro do chamador é a MESMA para código errado, expirado ou repetido.
 */
export async function verificarSegundoPasso(userId: number, entrada: { codigo?: unknown; recuperacao?: unknown }, agoraMs: number = Date.now()): Promise<ResultadoSegundoPasso> {
  const chave = lerChaveTotp(); if (!chave) throw new TotpIndisponivelError();
  if (entrada.recuperacao !== undefined) {
    const norm = normalizarRecuperacao(entrada.recuperacao);
    if (!norm) return { ok: false };
    return comTabelas(async () => {
      const livres = await db.select({ id: adminTotpRecuperacaoTable.id, hash: adminTotpRecuperacaoTable.codigoHash }).from(adminTotpRecuperacaoTable).where(and(eq(adminTotpRecuperacaoTable.userId, userId), isNull(adminTotpRecuperacaoTable.usadoEm)));
      for (const l of livres) {
        if (!(await comparePassword(norm, l.hash))) continue;
        const r = await db.update(adminTotpRecuperacaoTable).set({ usadoEm: new Date() }).where(and(eq(adminTotpRecuperacaoTable.id, l.id), isNull(adminTotpRecuperacaoTable.usadoEm))).returning({ id: adminTotpRecuperacaoTable.id });
        return r.length === 1 ? { ok: true as const, via: "recuperacao" as const, restantes: livres.length - 1 } : { ok: false as const };   // 0 linhas: alguém usou-o entretanto
      }
      return { ok: false as const };
    });
  }
  const [l] = await comTabelas(() => db.select().from(adminTotpTable).where(and(eq(adminTotpTable.userId, userId), sql`${adminTotpTable.ativadoEm} is not null`)).limit(1));
  if (!l) return { ok: false };
  const passo = passoDoCodigo(decifrarSegredo(l, userId, chave), entrada.codigo, agoraMs);
  if (passo === null) return { ok: false };
  // Anti-repetição ATÓMICA: só avança se o passo for maior que o último usado (um código usado, ou de um passo anterior, falha aqui mesmo dentro da janela).
  const r = await db.execute(sql`update admin_totp set ultimo_passo_usado = ${passo} where id = ${l.id} and ativado_em is not null and (ultimo_passo_usado is null or ultimo_passo_usado < ${passo}) returning id`);
  return r.rows.length === 1 ? { ok: true, via: "totp" } : { ok: false };
}

/** Só confirma um código TOTP (para desativar/regenerar/repor): consome o passo como no login. */
export async function verificarCodigoTotp(userId: number, codigo: unknown, agoraMs: number = Date.now()): Promise<boolean> {
  const r = await verificarSegundoPasso(userId, { codigo }, agoraMs);
  return r.ok;
}

/** Regenera os códigos de recuperação (os anteriores deixam de valer). */
export async function regenerarCodigos(userId: number): Promise<string[]> {
  const { codigos, hashes } = await gerarCodigosRecuperacao();
  await comTabelas(() => db.transaction(async (tx) => {
    await tx.delete(adminTotpRecuperacaoTable).where(eq(adminTotpRecuperacaoTable.userId, userId));
    await tx.insert(adminTotpRecuperacaoTable).values(hashes.map((h) => ({ userId, codigoHash: h })));
  }));
  return codigos;
}

/** Remove o TOTP e os códigos de uma conta. `invalidarSessoes`: apaga também as sessões de admin dessa conta (reposição). Devolve se havia TOTP. */
export async function removerTotp(userId: number, invalidarSessoes: boolean): Promise<boolean> {
  return comTabelas(() => db.transaction(async (tx) => {
    await tx.delete(adminTotpRecuperacaoTable).where(eq(adminTotpRecuperacaoTable.userId, userId));
    const r = await tx.delete(adminTotpTable).where(eq(adminTotpTable.userId, userId)).returning({ id: adminTotpTable.id });
    if (invalidarSessoes) await tx.execute(sql`delete from admin_sessoes where user_id = ${userId}`);
    return r.length > 0;
  }));
}
