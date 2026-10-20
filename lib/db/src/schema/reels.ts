import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const reelsTable = pgTable("reels", {
  id: serial("id").primaryKey(),
  autorId: integer("autor_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  videoUrl: text("video_url").notNull(),
  capaUrl: text("capa_url"),
  legenda: text("legenda"),
  somTitulo: text("som_titulo"),
  somArtista: text("som_artista"),
  exclusivo: boolean("exclusivo").notNull().default(false),
  /** Conteúdo +18 marcado pela criadora (PR 3). Só quem escolheu "ver" o vê; a autora vê sempre o seu. */
  mais18: boolean("mais18").notNull().default(false),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
  /** Retirada de conteúdo (takedown): esconde sem apagar; os ficheiros ficam retidos. */
  retiradoEm: timestamp("retirado_em"),
  retiradoMotivo: text("retirado_motivo"),
  retiradoPor: integer("retirado_por").references(() => usersTable.id, { onDelete: "set null" }),
});

export type Reel = typeof reelsTable.$inferSelect;
