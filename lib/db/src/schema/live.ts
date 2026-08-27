import { pgTable, serial, integer, text, timestamp, pgEnum, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const liveStreamStatusEnum = pgEnum("live_stream_status", ["agendado", "ao_vivo", "terminado"]);

export const liveStreamsTable = pgTable("live_streams", {
  id: serial("id").primaryKey(),
  criadorId: integer("criador_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  streamKey: uuid("stream_key").notNull().unique(),
  status: liveStreamStatusEnum("status").notNull().default("agendado"),
  totalVisualizadores: integer("total_visualizadores").notNull().default(0),
  iniciadoEm: timestamp("iniciado_em"),
  terminadoEm: timestamp("terminado_em"),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});

export const liveTipsTable = pgTable("live_tips", {
  id: serial("id").primaryKey(),
  streamId: integer("stream_id").notNull().references(() => liveStreamsTable.id, { onDelete: "cascade" }),
  remetenteId: integer("remetente_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  valor: integer("valor").notNull(), // Valor em centavos / inteiro
  mensagem: text("mensagem"),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});

export type LiveStream = typeof liveStreamsTable.$inferSelect;
export type LiveTip = typeof liveTipsTable.$inferSelect;
