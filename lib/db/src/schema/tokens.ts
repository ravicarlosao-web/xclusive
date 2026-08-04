import { pgTable, text, integer, timestamp, serial } from "drizzle-orm/pg-core";
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

/**
 * Sessões activas por utilizador — uma linha por refresh token emitido.
 * Usado para:
 *   • Limitar sessões simultâneas (MAX_SESSIONS_PER_USER, default 10)
 *   • "Logout de todos os dispositivos" (revoga todos os JTIs do utilizador)
 *   • Auditoria de dispositivos/IPs com sessão aberta
 */
export const activeSessionsTable = pgTable("active_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  refreshJti: text("refresh_jti").notNull().unique(),
  userAgent: text("user_agent"),
  ip: text("ip"),
  criadaEm: timestamp("criada_em").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
});

export type ActiveSession = typeof activeSessionsTable.$inferSelect;
