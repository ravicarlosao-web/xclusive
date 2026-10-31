import { pgTable, serial, integer, text, boolean, timestamp, pgEnum, index, uniqueIndex, primaryKey, check, numeric, varchar, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { purchasesTable } from "./subscriptions";

export const conversationTipoEnum = pgEnum("conversation_tipo", ["privada", "grupo"]);
export const messageTipoEnum = pgEnum("message_tipo", ["texto", "imagem", "audio", "post_partilhado", "gorjeta"]);

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

/**
 * Gorjeta enviada numa conversa (mensagem tipo 'gorjeta'). Liga a mensagem à transação em `purchases` (o ledger) e guarda a chave de
 * idempotência. ON DELETE RESTRICT: a prova financeira nunca se apaga por cascata. Ver lib/gorjetaMensagem.ts.
 */
export const messageTipsTable = pgTable("message_tips", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id").notNull().unique().references(() => messagesTable.id, { onDelete: "restrict" }),
  conversationId: integer("conversation_id").notNull().references(() => conversationsTable.id, { onDelete: "restrict" }),
  remetenteId: integer("remetente_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  criadorId: integer("criador_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  purchaseId: integer("purchase_id").notNull().unique().references(() => purchasesTable.id, { onDelete: "restrict" }),
  valor: numeric("valor", { precision: 10, scale: 2 }).notNull(),
  comissao: numeric("comissao", { precision: 10, scale: 2 }).notNull(),
  taxaComissao: numeric("taxa_comissao", { precision: 5, scale: 2 }).notNull(),
  chaveIdempotencia: varchar("chave_idempotencia", { length: 64 }).notNull(),
  /** SHA-256 de (conversa, valor, mensagem): detetar a mesma chave reutilizada com outro pedido. */
  pedidoHash: varchar("pedido_hash", { length: 64 }).notNull(),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
}, (t) => [
  unique("message_tips_remetente_chave_uq").on(t.remetenteId, t.chaveIdempotencia),
  index("message_tips_conversa_idx").on(t.conversationId),
  index("message_tips_criador_idx").on(t.criadorId, t.criadoEm),
  check("message_tips_valor_chk", sql`${t.valor} > 0`),
  check("message_tips_comissao_chk", sql`${t.comissao} >= 0 AND ${t.comissao} <= ${t.valor}`),
  check("message_tips_nao_a_si_proprio", sql`${t.remetenteId} <> ${t.criadorId}`),
]);

export type MessageTip = typeof messageTipsTable.$inferSelect;
export type Conversation = typeof conversationsTable.$inferSelect;
export type Message = typeof messagesTable.$inferSelect;
