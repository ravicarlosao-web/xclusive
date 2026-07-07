import { pgTable, serial, integer, text, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const notificationTipoEnum = pgEnum("notification_tipo", [
  "novo_seguidor",
  "like_post",
  "like_reel",
  "comentario",
  "mencao",
  "nova_subscricao",
  "pagamento_recebido",
]);

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  destinatarioId: integer("destinatario_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  tipo: notificationTipoEnum("tipo").notNull(),
  atorId: integer("ator_id").references(() => usersTable.id, { onDelete: "set null" }),
  alvoId: integer("alvo_id"),
  postThumbnail: text("post_thumbnail"),
  lida: boolean("lida").notNull().default(false),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});

export type Notification = typeof notificationsTable.$inferSelect;
