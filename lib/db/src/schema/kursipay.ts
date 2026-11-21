import { pgTable, serial, integer, varchar, text, bigint, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { topupRequestsTable } from "./admin";

/**
 * Carregamento automático de saldo pela kursiPay (gateway de pagamentos de Angola). Entradas só: nunca há reembolsos pela nossa parte.
 * kursipay_pagamentos: UM pagamento kursiPay por pedido de carregamento (topup_requests, payment_method = 'kursipay'), com o id da kursiPay (pay_…, único; NULL até a kursiPay responder),
 *   o ambiente (sandbox | production, derivado da chave), o valor em CÊNTIMOS INTEIROS, a moeda e o estado espelhado (a_criar | pending | paid | failed | expired | refunded | revisao).
 * kursipay_eventos: eventos de webhook JÁ processados (id evt_… como chave única): a deduplicação grava-se na MESMA transação que o processamento.
 * FKs RESTRICT: um pagamento ou um utilizador com histórico kursiPay não se apaga por cascata.
 */
export const kursipayPagamentosTable = pgTable("kursipay_pagamentos", {
  id: serial("id").primaryKey(),
  topupRequestId: integer("topup_request_id").notNull().unique().references(() => topupRequestsTable.id, { onDelete: "restrict" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  kursipayId: varchar("kursipay_id", { length: 40 }).unique(),
  ambiente: varchar("ambiente", { length: 12 }).notNull(),
  valorCentimos: bigint("valor_centimos", { mode: "number" }).notNull(),
  moeda: varchar("moeda", { length: 3 }).notNull(),
  estado: varchar("estado", { length: 24 }).notNull().default("a_criar"),
  checkoutUrl: text("checkout_url"),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
  atualizadoEm: timestamp("atualizado_em").notNull().defaultNow(),
  pagoEm: timestamp("pago_em"),
}, (t) => [index("kursipay_pagamentos_user_idx").on(t.userId)]);

export const kursipayEventosTable = pgTable("kursipay_eventos", {
  eventoId: varchar("evento_id", { length: 40 }).primaryKey(),
  tipo: varchar("tipo", { length: 40 }).notNull(),
  kursipayPagamentoId: varchar("kursipay_pagamento_id", { length: 40 }),
  ambiente: varchar("ambiente", { length: 12 }),
  resultado: varchar("resultado", { length: 30 }).notNull(),
  recebidoEm: timestamp("recebido_em").notNull().defaultNow(),
});

export type KursipayPagamento = typeof kursipayPagamentosTable.$inferSelect;
