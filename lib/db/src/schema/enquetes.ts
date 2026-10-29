import { pgTable, serial, integer, text, timestamp, unique, foreignKey } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { postsTable } from "./posts";

/** Enquete: um post de texto (tipo 'texto') com pergunta (a legenda) e 2 a 4 opções. Termina em `termina_em` (calculado em consulta). */
export const enquetesTable = pgTable("enquetes", {
  id: serial("id").primaryKey(),
  postId: integer("post_id").notNull().unique().references(() => postsTable.id, { onDelete: "cascade" }),
  /** 'todos' | 'seguidores' (CHECK na BD). */
  audiencia: text("audiencia").notNull().default("todos"),
  terminaEm: timestamp("termina_em").notNull(),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});

export const enqueteOpcoesTable = pgTable("enquete_opcoes", {
  id: serial("id").primaryKey(),
  enqueteId: integer("enquete_id").notNull().references(() => enquetesTable.id, { onDelete: "cascade" }),
  ordem: integer("ordem").notNull(),
  texto: text("texto").notNull(),
}, (t) => [
  unique("enquete_opcoes_ordem_unica").on(t.enqueteId, t.ordem),
  unique("enquete_opcoes_id_enquete_unica").on(t.id, t.enqueteId),
]);

/** Voto anónimo para os outros: a ligação à conta (user_id) nunca sai da BD. user_id passa a NULL se a conta for apagada. */
export const enqueteVotosTable = pgTable("enquete_votos", {
  id: serial("id").primaryKey(),
  enqueteId: integer("enquete_id").notNull().references(() => enquetesTable.id, { onDelete: "cascade" }),
  opcaoId: integer("opcao_id").notNull(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
}, (t) => [
  unique("enquete_votos_unico").on(t.enqueteId, t.userId),
  foreignKey({ name: "enquete_votos_opcao_fk", columns: [t.opcaoId, t.enqueteId], foreignColumns: [enqueteOpcoesTable.id, enqueteOpcoesTable.enqueteId] }).onDelete("cascade"),
]);

export type Enquete = typeof enquetesTable.$inferSelect;
