import { pgTable, serial, integer, text, timestamp, varchar, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

/**
 * Tokens de uso único enviados por email (recuperação de palavra-passe; mais tarde, verificação de email).
 * Guarda SÓ o hash SHA-256 do token (o token em claro só existe no email). Uso único e atómico (usado_em), com expiração.
 * `email` = o endereço a que foi enviado (em minúsculas), para o limite de emails por endereço.
 */
export const emailTokensTable = pgTable("email_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  tipo: varchar("tipo", { length: 30 }).notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
  expiraEm: timestamp("expira_em").notNull(),
  usadoEm: timestamp("usado_em"),
  ip: varchar("ip", { length: 45 }),
}, (t) => [
  uniqueIndex("email_tokens_token_hash_uq").on(t.tokenHash),
  index("email_tokens_user_tipo_idx").on(t.userId, t.tipo),
  index("email_tokens_email_tipo_criado_idx").on(t.email, t.tipo, t.criadoEm),
  check("email_tokens_tipo_chk", sql`${t.tipo} IN ('recuperar_password', 'verificar_email')`),
]);

export type EmailToken = typeof emailTokensTable.$inferSelect;
