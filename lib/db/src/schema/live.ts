import { pgTable, serial, integer, text, timestamp, pgEnum, uuid, numeric, check, unique, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { purchasesTable } from "./subscriptions";

export const liveStreamStatusEnum = pgEnum("live_stream_status", ["agendado", "ao_vivo", "terminado"]);

// Tipo de acesso da live, escolhido ao abrir (POST /live/start) e fixo até terminar.
export const liveAcessoEnum = pgEnum("live_acesso", ["gratuita", "paga"]);

export const liveStreamsTable = pgTable("live_streams", {
  id: serial("id").primaryKey(),
  criadorId: integer("criador_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  streamKey: uuid("stream_key").notNull().unique(),
  status: liveStreamStatusEnum("status").notNull().default("agendado"),
  totalVisualizadores: integer("total_visualizadores").notNull().default(0),
  iniciadoEm: timestamp("iniciado_em"),
  terminadoEm: timestamp("terminado_em"),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
  tipo: liveAcessoEnum("tipo").notNull().default("gratuita"),
  // Preço inteiro em Kz; 0 quando gratuita. Limites validados em lib/liveTicket.ts.
  preco: numeric("preco", { precision: 10, scale: 2 }).notNull().default("0"),
}, (t) => [
  check(
    "live_streams_tipo_preco_chk",
    sql`(${t.tipo} = 'gratuita' AND ${t.preco} = 0) OR (${t.tipo} = 'paga' AND ${t.preco} > 0)`,
  ),
]);

export const liveTipsTable = pgTable("live_tips", {
  id: serial("id").primaryKey(),
  streamId: integer("stream_id").notNull().references(() => liveStreamsTable.id, { onDelete: "cascade" }),
  remetenteId: integer("remetente_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  valor: integer("valor").notNull(), // Valor em centavos / inteiro
  mensagem: text("mensagem"),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});

// Bilhete de acesso a uma live paga. Um por (live, utilizador).
export const liveTicketsTable = pgTable("live_tickets", {
  id: serial("id").primaryKey(),
  liveId: integer("live_id").notNull().references(() => liveStreamsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  valor: numeric("valor", { precision: 10, scale: 2 }).notNull(),
  comissao: numeric("comissao", { precision: 10, scale: 2 }).notNull().default("0"),
  purchaseId: integer("purchase_id").references(() => purchasesTable.id, { onDelete: "set null" }),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
}, (t) => [
  unique("live_tickets_live_user_uniq").on(t.liveId, t.userId),
  index("live_tickets_user_idx").on(t.userId),
]);

export type LiveStream = typeof liveStreamsTable.$inferSelect;
export type LiveTip = typeof liveTipsTable.$inferSelect;
export type LiveTicket = typeof liveTicketsTable.$inferSelect;
