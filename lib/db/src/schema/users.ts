import { pgTable, serial, text, boolean, timestamp, pgEnum, varchar, numeric, check, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
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
  /**
   * Preferência sobre conteúdo +18: 'ver' | 'filtrar'. NULL = ainda não escolheu (o servidor trata como 'filtrar').
   * A escolha e a respetiva data são gravadas na MESMA transação que a linha de user_mais18_choices.
   */
  preferenciaMais18: text("preferencia_mais18"),
  preferenciaMais18Em: timestamp("preferencia_mais18_em"),
  /**
   * Conta encerrada pelo próprio utilizador (ver routes/users.ts: POST /users/me/encerrar). Uma conta encerrada tem SEMPRE
   * ativo=false (CHECK abaixo): a BD recusa reativá-la sem reabrir (POST /admin/users/:id/reabrir limpa os dois campos).
   */
  encerradaEm: timestamp("encerrada_em"),
  /**
   * Conta banida de forma permanente (ver lib/banimento.ts). Tem SEMPRE ativo=false (CHECK abaixo); não se reabre nem se reativa.
   * Os identificadores (email, documento) ficam bloqueados em `identifier_blocks`, só como hash.
   */
  banidaEm: timestamp("banida_em"),
}, (table) => [
  check("users_banida_inativa_chk", sql`${table.banidaEm} IS NULL OR ${table.ativo} = false`),
  check("users_encerrada_inativa_chk", sql`${table.encerradaEm} IS NULL OR ${table.ativo} = false`),
  check("users_saldo_nao_negativo", sql`${table.saldo} >= 0`),
  check("users_ganhos_nao_negativo", sql`${table.ganhos} >= 0`),
  check("users_preferencia_mais18_check", sql`${table.preferenciaMais18} IN ('ver', 'filtrar')`),
]);

/**
 * Fila de encerramento de contas: uma linha por encerramento (a janela de arrependimento termina em `apagar_apos`; a
 * purga real é do PR de retenção). `ON DELETE RESTRICT`: a prova do encerramento conserva-se.
 */
export const accountClosuresTable = pgTable("account_closures", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  encerradaEm: timestamp("encerrada_em").notNull().defaultNow(),
  origem: varchar("origem", { length: 20 }).notNull().default("utilizador"),
  tipoConta: varchar("tipo_conta", { length: 20 }).notNull(),
  ip: varchar("ip", { length: 45 }),
  userAgent: varchar("user_agent", { length: 400 }),
  apagarApos: timestamp("apagar_apos").notNull(),
  /** pendente | reaberta | processada */
  estado: varchar("estado", { length: 20 }).notNull().default("pendente"),
  reabertaEm: timestamp("reaberta_em"),
  reabertaPor: integer("reaberta_por").references(() => usersTable.id, { onDelete: "set null" }),
  reabertaMotivo: text("reaberta_motivo"),
  processadaEm: timestamp("processada_em"),
}, (t) => [
  index("account_closures_fila_idx").on(t.estado, t.apagarApos),
]);

/**
 * Bloqueios de identificadores (banimento permanente; reutilizável pelo PR dos menores). Guarda SÓ HASHES (HMAC-SHA256 com
 * BAN_HASH_PEPPER), nunca o email nem o documento em claro. Único por (tipo, hash). `user_id` ON DELETE RESTRICT.
 */
export const identifierBlocksTable = pgTable("identifier_blocks", {
  id: serial("id").primaryKey(),
  /** email | documento */
  tipo: varchar("tipo", { length: 20 }).notNull(),
  hash: varchar("hash", { length: 64 }).notNull(),
  /** banimento | menor */
  origem: varchar("origem", { length: 20 }).notNull().default("banimento"),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  banidaPor: integer("banida_por").references(() => usersTable.id, { onDelete: "set null" }),
  motivo: text("motivo"),
  /** Caso de menor que originou o bloqueio (FK para menor_cases na BD; sem referência aqui para evitar import circular). */
  casoId: integer("caso_id"),
  criadaEm: timestamp("criada_em").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("identifier_blocks_tipo_hash_uq").on(t.tipo, t.hash),
  index("identifier_blocks_user_idx").on(t.userId),
  check("identifier_blocks_tipo_chk", sql`${t.tipo} IN ('email', 'documento')`),
  check("identifier_blocks_origem_chk", sql`${t.origem} IN ('banimento', 'menor')`),
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
  /** Versões dos restantes documentos e aceite de cookies (NULL nas linhas anteriores ao aceite múltiplo). */
  conteudoVersao: text("conteudo_versao"),
  direitosAutorVersao: text("direitos_autor_versao"),
  reembolsosVersao: text("reembolsos_versao"),
  cookiesAceites: boolean("cookies_aceites"),
  aceiteEm: timestamp("aceite_em").notNull().defaultNow(),
  // Evidência do registo (ip, user_agent): dados pessoais — prazo de retenção a definir pelo advogado.
  ip: varchar("ip", { length: 45 }),
  /** User-Agent do pedido (cortado a 400 caracteres). */
  userAgent: varchar("user_agent", { length: 400 }),
  /** Declarou ter 18 anos ou mais (NULL nas linhas anteriores à declaração). */
  maioridadeConfirmada: boolean("maioridade_confirmada"),
  /** Origem do aceite: 'registo' (hoje); futuros re-aceites usam outro valor. */
  origem: varchar("origem", { length: 20 }).notNull().default("registo"),
}, (t) => [
  index("user_legal_acceptances_user_idx").on(t.userId),
]);

/**
 * Histórico (append-only) das escolhas sobre conteúdo +18: valor, versão do texto do cartão mostrado,
 * data e IP. Escrita na MESMA transação do UPDATE de users.preferencia_mais18. O IP nunca é registado em logs.
 */
export const userMais18ChoicesTable = pgTable("user_mais18_choices", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  valor: text("valor").notNull(),
  textoVersao: varchar("texto_versao", { length: 40 }).notNull(),
  escolhidaEm: timestamp("escolhida_em").notNull().defaultNow(),
  ip: varchar("ip", { length: 45 }),
}, (t) => [
  check("user_mais18_choices_valor_check", sql`${t.valor} IN ('ver', 'filtrar')`),
  index("user_mais18_choices_user_idx").on(t.userId, t.escolhidaEm),
]);

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, criadoEm: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
