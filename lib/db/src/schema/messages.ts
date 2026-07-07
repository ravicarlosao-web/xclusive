import { pgTable, serial, integer, text, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const conversationTipoEnum = pgEnum("conversation_tipo", ["privada", "grupo"]);
export const messageTipoEnum = pgEnum("message_tipo", ["texto", "imagem", "audio", "post_partilhado"]);

export const conversationsTable = pgTable("conversations", {
  id: serial("id").primaryKey(),
  tipo: conversationTipoEnum("tipo").notNull().default("privada"),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});

export const conversationParticipantsTable = pgTable("conversation_participants", {
  conversationId: integer("conversation_id").notNull().references(() => conversationsTable.id, { onDelete: "cascade" }),
  utilizadorId: integer("utilizador_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
});

export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => conversationsTable.id, { onDelete: "cascade" }),
  autorId: integer("autor_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  tipo: messageTipoEnum("tipo").notNull().default("texto"),
  conteudo: text("conteudo"),
  mediaUrl: text("media_url"),
  lido: boolean("lido").notNull().default(false),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});

export type Conversation = typeof conversationsTable.$inferSelect;
export type Message = typeof messagesTable.$inferSelect;
