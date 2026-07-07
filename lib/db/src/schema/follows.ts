import { pgTable, serial, integer, timestamp, pgEnum, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const followStateEnum = pgEnum("follow_state", ["aceite", "pendente"]);

export const followsTable = pgTable("follows", {
  id: serial("id").primaryKey(),
  seguidorId: integer("seguidor_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  seguidoId: integer("seguido_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  estado: followStateEnum("estado").notNull().default("aceite"),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
}, (t) => [unique("follows_unique").on(t.seguidorId, t.seguidoId)]);

export type Follow = typeof followsTable.$inferSelect;
