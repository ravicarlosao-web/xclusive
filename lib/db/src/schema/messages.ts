import { pgTable, serial, integer, text, boolean, timestamp, pgEnum, index, uniqueIndex, primaryKey, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
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
}, (t) => [
  // Suporta GET /api/conversations — filtra participações por utilizador sem full-scan
  index("conv_participants_utilizador_id_idx").on(t.utilizadorId),
  // Um utilizador só participa uma vez numa conversa; também serve as consultas por conversa
  uniqueIndex("conv_participants_unico").on(t.conversationId, t.utilizadorId),
]);

export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => conversationsTable.id, { onDelete: "cascade" }),
  autorId: integer("autor_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  tipo: messageTipoEnum("tipo").notNull().default("texto"),
  conteudo: text("conteudo"),
  mediaUrl: text("media_url"),
  lido: boolean("lido").notNull().default(false),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
}, (t) => [
  index("messages_conversa_id_idx").on(t.conversationId, t.id),
  index("messages_conversa_autor_idx").on(t.conversationId, t.autorId),
]);

/**
 * Bloqueios entre utilizadores: afetam SÓ mensagens e novas conversas (nunca seguir, comentários, lives, subscrições nem gorjetas).
 * Ver lib/permissaoMensagem.ts. Contas de administração não bloqueiam nem são bloqueadas.
 */
export const userBlocksTable = pgTable("user_blocks", {
  blockerId: integer("blocker_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  blockedId: integer("blocked_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.blockerId, t.blockedId] }),
  index("user_blocks_blocked_idx").on(t.blockedId),
  check("user_blocks_nao_a_si_proprio", sql`${t.blockerId} <> ${t.blockedId}`),
]);

export type Conversation = typeof conversationsTable.$inferSelect;
export type Message = typeof messagesTable.$inferSelect;
