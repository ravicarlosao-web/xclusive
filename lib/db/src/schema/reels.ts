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
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});

export type Reel = typeof reelsTable.$inferSelect;
