import { pgTable, serial, text, boolean, timestamp, pgEnum, varchar, numeric, check, integer, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tipoContaEnum = pgEnum("tipo_conta", ["pessoal", "criador"]);
export const tipoSubscricaoEnum = pgEnum("tipo_subscricao", ["gratuita", "paga"]);

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
  /**
   * Taxa de comissão personalizada para este criador (percentagem, 0-100).
   * NULL = usa a taxa global definida em platform_settings.commission_rate.
   * Quando definida, sobrepõe a taxa global exclusivamente para este criador.
   */
  comissaoPersonalizada: numeric("comissao_personalizada", { precision: 5, scale: 2 }),
  /**
   * Tipo de subscrição da criadora para NOVAS subscrições: "gratuita" (sem cobrança nem fim)
   * ou "paga" (plano, 1 mês, renovação manual). Default "paga" = comportamento anterior.
   * Subscrições em curso não são afetadas por mudanças.
   */
  tipoSubscricao: tipoSubscricaoEnum("tipo_subscricao").notNull().default("paga"),
}, (table) => [
  check("users_saldo_nao_negativo", sql`${table.saldo} >= 0`),
  check("users_ganhos_nao_negativo", sql`${table.ganhos} >= 0`),
]);

/**
 * Aceite dos documentos legais no registo (prova do que foi aceite, quando e de onde).
 * Escrita na MESMA transação da criação do utilizador. O IP nunca é registado em logs.
 * Uma linha por aceite (um novo aceite de versões futuras acrescenta outra linha).
 */
export const userLegalAcceptancesTable = pgTable("user_legal_acceptances", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  termosVersao: varchar("termos_versao", { length: 40 }).notNull(),
  privacidadeVersao: varchar("privacidade_versao", { length: 40 }).notNull(),
  aceiteEm: timestamp("aceite_em").notNull().defaultNow(),
  ip: varchar("ip", { length: 45 }),
}, (t) => [
  index("user_legal_acceptances_user_idx").on(t.userId),
]);

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, criadoEm: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
