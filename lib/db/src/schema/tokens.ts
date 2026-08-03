import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Tokens JWT revogados (logout explícito + contas suspensas).
 * Entradas são removidas automaticamente após a data de expiração.
 */
export const revokedTokensTable = pgTable("revoked_tokens", {
  jti: text("jti").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at").notNull().defaultNow(),
});

export type RevokedToken = typeof revokedTokensTable.$inferSelect;
