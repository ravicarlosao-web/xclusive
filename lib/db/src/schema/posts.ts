import { pgTable, serial, integer, text, boolean, timestamp, pgEnum, numeric, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const postTipoEnum = pgEnum("post_tipo", ["imagem", "video", "carrossel"]);
export const mediaTipoEnum = pgEnum("media_tipo", ["imagem", "video"]);

export const postsTable = pgTable("posts", {
  id: serial("id").primaryKey(),
  autorId: integer("autor_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  legenda: text("legenda"),
  localizacao: text("localizacao"),
  tipo: postTipoEnum("tipo").notNull().default("imagem"),
  exclusivo: boolean("exclusivo").notNull().default(false),
  precoDesbloqueio: numeric("preco_desbloqueio", { precision: 10, scale: 2 }),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});

export const postMediaTable = pgTable("post_media", {
  id: serial("id").primaryKey(),
  postId: integer("post_id").notNull().references(() => postsTable.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  tipo: mediaTipoEnum("tipo").notNull().default("imagem"),
  ordem: integer("ordem").notNull().default(0),
});

export const likesTable = pgTable("likes", {
  id: serial("id").primaryKey(),
  utilizadorId: integer("utilizador_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  alvoTipo: text("alvo_tipo").notNull(), // post, reel, comentario
  alvoId: integer("alvo_id").notNull(),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
}, (t) => [unique("likes_unique").on(t.utilizadorId, t.alvoTipo, t.alvoId)]);

export const savedPostsTable = pgTable("saved_posts", {
  id: serial("id").primaryKey(),
  utilizadorId: integer("utilizador_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  postId: integer("post_id").notNull().references(() => postsTable.id, { onDelete: "cascade" }),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
}, (t) => [unique("saved_posts_unique").on(t.utilizadorId, t.postId)]);

export const commentsTable = pgTable("comments", {
  id: serial("id").primaryKey(),
  postId: integer("post_id").notNull().references(() => postsTable.id, { onDelete: "cascade" }),
  autorId: integer("autor_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  comentarioPaiId: integer("comentario_pai_id"),
  texto: text("texto").notNull(),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});

export const hashtagsTable = pgTable("hashtags", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull().unique(),
  totalPosts: integer("total_posts").notNull().default(0),
});

export const postHashtagsTable = pgTable("post_hashtags", {
  postId: integer("post_id").notNull().references(() => postsTable.id, { onDelete: "cascade" }),
  hashtagId: integer("hashtag_id").notNull().references(() => hashtagsTable.id, { onDelete: "cascade" }),
});

export type Post = typeof postsTable.$inferSelect;
export type PostMedia = typeof postMediaTable.$inferSelect;
export type Like = typeof likesTable.$inferSelect;
export type Comment = typeof commentsTable.$inferSelect;
export type Hashtag = typeof hashtagsTable.$inferSelect;
