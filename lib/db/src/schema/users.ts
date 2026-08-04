import { pgTable, serial, text, boolean, timestamp, pgEnum, varchar, numeric, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tipoContaEnum = pgEnum("tipo_conta", ["pessoal", "criador"]);

// Roles: 'user' | 'creator' | 'admin' | 'superadmin'
// Added via: ALTER TABLE users ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'user';

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 50 }).notNull().unique(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  nomeExibicao: varchar("nome_exibicao", { length: 100 }).notNull(),
  bio: text("bio"),
  avatarUrl: text("avatar_url"),
  capaUrl: text("capa_url"),
  link: text("link"),
  tipoConta: tipoContaEnum("tipo_conta").notNull().default("pessoal"),
  verificado: boolean("verificado").notNull().default(false),
  privado: boolean("privado").notNull().default(false),
  dataNascimento: text("data_nascimento"),
  ativo: boolean("ativo").notNull().default(true),
  role: varchar("role", { length: 20 }).notNull().default("user"),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
  /**
   * Saldo pré-carregado disponível para gorjetas e subscrições.
   * Nunca pode ser negativo — garantido por constraint na DB e verificação na aplicação.
   */
  saldo: numeric("saldo", { precision: 12, scale: 2 }).notNull().default("0"),
  /**
   * Ganhos acumulados do criador (créditos recebidos de gorjetas e subscrições).
   */
  ganhos: numeric("ganhos", { precision: 12, scale: 2 }).notNull().default("0"),
}, (table) => [
  check("users_saldo_nao_negativo", sql`${table.saldo} >= 0`),
]);

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, criadoEm: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
