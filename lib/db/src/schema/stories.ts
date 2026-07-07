import { pgTable, serial, integer, text, boolean, timestamp, pgEnum, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const storyAudienciaEnum = pgEnum("story_audiencia", ["todos", "subscritores", "proximos"]);

export const storiesTable = pgTable("stories", {
  id: serial("id").primaryKey(),
  autorId: integer("autor_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  mediaUrl: text("media_url").notNull(),
  tipo: text("tipo").notNull().default("imagem"), // imagem, video
  duracao: integer("duracao").notNull().default(5),
  audiencia: storyAudienciaEnum("audiencia").notNull().default("todos"),
  expiraEm: timestamp("expira_em").notNull(),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});

export const storyViewsTable = pgTable("story_views", {
  id: serial("id").primaryKey(),
  storyId: integer("story_id").notNull().references(() => storiesTable.id, { onDelete: "cascade" }),
  utilizadorId: integer("utilizador_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  vistoEm: timestamp("visto_em").notNull().defaultNow(),
}, (t) => [unique("story_views_unique").on(t.storyId, t.utilizadorId)]);

export const highlightsTable = pgTable("highlights", {
  id: serial("id").primaryKey(),
  utilizadorId: integer("utilizador_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  titulo: text("titulo").notNull(),
  capaUrl: text("capa_url"),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});

export const highlightStoriesTable = pgTable("highlight_stories", {
  highlightId: integer("highlight_id").notNull().references(() => highlightsTable.id, { onDelete: "cascade" }),
  storyId: integer("story_id").notNull().references(() => storiesTable.id, { onDelete: "cascade" }),
});

export type Story = typeof storiesTable.$inferSelect;
export type StoryView = typeof storyViewsTable.$inferSelect;
export type Highlight = typeof highlightsTable.$inferSelect;
