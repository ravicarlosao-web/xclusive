/**
 * Crédito de um carregamento AUTOMÁTICO (usado SÓ pela kursiPay). Reproduz fielmente a lógica do webhook da AppyPay (routes/appypay.ts):
 *   1. a linha da conta bloqueia-se FOR UPDATE (antes de ler ou mexer em nada);
 *   2. conta inativa (suspensa, encerrada ou banida) ou inexistente NÃO é creditada: o pedido passa a «revisao_manual» (o valor e a referência ficam na própria linha);
 *   3. o pedido é «reclamado» de forma atómica (UPDATE … WHERE status em curso … RETURNING): só um chamador o consegue, por isso o crédito acontece UMA só vez;
 *   4. o crédito usa o valor da BASE DE DADOS (a linha do pedido), nunca o de um corpo de pedido.
 * Diferença deliberada: antes de bloquear a conta, bloqueia-se também a linha do pedido (FOR UPDATE) para ler o dono, e devolve-se o saldo antes e depois (para a auditoria).
 * O crédito está em linha noutros sítios (aprovação do admin, webhook AppyPay, ajustes): ver BUGS.md; esta função não os altera nem é usada por eles.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { usersTable, topupRequestsTable } from "@workspace/db";
import type { db } from "@workspace/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ResultadoCredito =
  | { estado: "creditado"; userId: number; valor: number; saldoAntes: number; saldoDepois: number }
  | { estado: "revisao_manual"; userId: number; valor: number }
  | { estado: "ja_processado" };

export interface PedidoCredito {
  topupId: number;
  /** Estados em que o pedido ainda pode ser creditado (os «em curso»). */
  estadosEmCurso: string[];
  notaCreditado: string;
  notaContaInativa: string;
}

export async function creditarCarregamento(tx: Tx, p: PedidoCredito): Promise<ResultadoCredito> {
  const [pedido] = await tx.select({ userId: topupRequestsTable.userId, status: topupRequestsTable.status }).from(topupRequestsTable).where(eq(topupRequestsTable.id, p.topupId)).for("update").limit(1);
  if (!pedido) return { estado: "ja_processado" };
  const [conta] = await tx.select({ ativo: usersTable.ativo, saldo: usersTable.saldo }).from(usersTable).where(eq(usersTable.id, pedido.userId)).for("update");
  const contaInativa = !conta || !conta.ativo;

  const [reclamado] = await tx
    .update(topupRequestsTable)
    .set(contaInativa
      ? { status: "revisao_manual", processadoEm: new Date(), notas: p.notaContaInativa }
      : { status: "aprovado", processadoEm: new Date(), notas: p.notaCreditado })
    .where(and(eq(topupRequestsTable.id, p.topupId), inArray(topupRequestsTable.status, p.estadosEmCurso)))
    .returning({ userId: topupRequestsTable.userId, amount: topupRequestsTable.amount });
  if (!reclamado) return { estado: "ja_processado" };
  if (contaInativa) return { estado: "revisao_manual", userId: reclamado.userId, valor: Number(reclamado.amount) };

  const [c] = await tx.update(usersTable).set({ saldo: sql`${usersTable.saldo} + ${reclamado.amount}` }).where(eq(usersTable.id, reclamado.userId)).returning({ saldo: usersTable.saldo });
  return { estado: "creditado", userId: reclamado.userId, valor: Number(reclamado.amount), saldoAntes: Number(conta!.saldo), saldoDepois: Number(c.saldo) };
}
