import { and, eq, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db, liveTipsTable, purchasesTable } from "@workspace/db";
import { jsonCanonico, sha256Hex } from "./hashCanonico";

/**
 * Idempotência das gorjetas de posts (POST /posts/:id/gorjeta) e de lives (POST /live/:id/tip). A chave é OPCIONAL: sem ela o
 * comportamento é o de sempre. Com ela, a mesma (comprador, chave) devolve a resposta original sem nova cobrança.
 * A chave e o hash do pedido gravam-se na própria compra (purchases.chave_idempotencia / pedido_hash; índice único parcial).
 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Q = Tx | typeof db;

export const CHAVE_REGEX = /^[A-Za-z0-9_-]{16,64}$/;
const MSG_CHAVE = "Chave de idempotência inválida (16 a 64 caracteres: letras, números, - e _).";
export const chaveOpcional = z.string({ error: MSG_CHAVE }).regex(CHAVE_REGEX, MSG_CHAVE).optional();

export const NOME_INDICE_CHAVE = "purchases_comprador_chave_uq";

/** 409: a chave já foi usada com outro pedido de gorjeta. */
export class ChaveReutilizadaError extends Error {
  readonly httpStatus = 409;
  readonly codigo = "chave_reutilizada";
  constructor() { super("Esta chave já foi usada com outro pedido de gorjeta."); this.name = "ChaveReutilizadaError"; }
}

/** SHA-256 do pedido: tipo da gorjeta, alvo, valor e mensagem (se houver). */
export const hashPedidoGorjeta = (tipo: "post" | "live", alvoId: number, valor: number, mensagem: string | null | undefined): string =>
  sha256Hex(jsonCanonico({ tipo, alvo: alvoId, valor, mensagem: mensagem || null }));

/** Compra original desta (comprador, chave), ou null. Com outro hash → ChaveReutilizadaError. */
export async function lerCompraPorChave(q: Q, compradorId: number, chave: string, hash: string) {
  const [c] = await q.select().from(purchasesTable)
    .where(and(eq(purchasesTable.compradorId, compradorId), eq(purchasesTable.chaveIdempotencia, chave))).limit(1);
  if (!c) return null;
  if (c.pedidoHash !== hash) throw new ChaveReutilizadaError();
  return c;
}

/** A compra sem as colunas internas da idempotência (a resposta tem sempre a mesma forma, com ou sem chave). */
export function compraParaResposta<T extends { chaveIdempotencia?: unknown; pedidoHash?: unknown }>(c: T): Omit<T, "chaveIdempotencia" | "pedidoHash"> {
  const { chaveIdempotencia: _k, pedidoHash: _h, ...resto } = c;
  return resto;
}

/** A linha de live_tips gravada na MESMA transação da compra (partilham o criado_em = now() da transação). */
export async function lerTipDaCompra(q: Q, compra: { id: number; conteudoId: number | null; compradorId: number }) {
  const [t] = await q.select().from(liveTipsTable).where(and(
    eq(liveTipsTable.streamId, compra.conteudoId ?? -1),
    eq(liveTipsTable.remetenteId, compra.compradorId),
    sql`${liveTipsTable.criadoEm} = (SELECT criado_em FROM purchases WHERE id = ${compra.id})`,
  )).orderBy(liveTipsTable.id).limit(1);
  return t ?? null;
}

/** Violação do índice único da chave (corrida que escapou à leitura): resolve-se repetindo a leitura. */
export function foiViolacaoDaChave(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } } | null;
  const code = e?.code ?? e?.cause?.code, constraint = e?.constraint ?? e?.cause?.constraint;
  return code === "23505" && constraint === NOME_INDICE_CHAVE;
}
