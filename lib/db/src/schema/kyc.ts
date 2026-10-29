import { index, integer, pgEnum, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const kycStatusEnum = pgEnum("kyc_status", ["pendente", "aprovado", "rejeitado"]);

export const kycSubmissionsTable = pgTable("kyc_submissions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  nomeCompleto: varchar("nome_completo", { length: 150 }).notNull(),
  dataNascimento: varchar("data_nascimento", { length: 10 }).notNull(),
  tipoDocumento: varchar("tipo_documento", { length: 30 }).notNull(),
  numeroDocumento: varchar("numero_documento", { length: 50 }).notNull(),
  paisEmissao: varchar("pais_emissao", { length: 100 }).notNull(),
  documentoKey: text("documento_key").notNull(),
  selfieKey: text("selfie_key").notNull(),
  livenessKey: text("liveness_key").notNull(),
  status: kycStatusEnum("status").notNull().default("pendente"),
  motivoRejeicao: text("motivo_rejeicao"),
  submetidoEm: timestamp("submetido_em").notNull().defaultNow(),
  revistoEm: timestamp("revisto_em"),
  revistoPor: integer("revisto_por").references(() => usersTable.id, { onDelete: "set null" }),
});

export type KycSubmission = typeof kycSubmissionsTable.$inferSelect;

/**
 * Aceite dos Termos para Criadoras, gravado na MESMA transação que a submissão KYC e a passagem a criadora.
 * Uma linha por pedido (um novo pedido após recusa gera nova linha). O IP e o User-Agent são dados pessoais:
 * ficam só na base de dados, nunca em logs. `ON DELETE RESTRICT` no utilizador: a prova de aceite conserva-se
 * (não é apagada em cascata se um dia houver eliminação real de utilizadores).
 */
export const creatorTermsAcceptancesTable = pgTable("creator_terms_acceptances", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  versao: varchar("versao", { length: 40 }).notNull(),
  kycSubmissionId: integer("kyc_submission_id").references(() => kycSubmissionsTable.id, { onDelete: "set null" }),
  aceiteEm: timestamp("aceite_em").notNull().defaultNow(),
  ip: varchar("ip", { length: 45 }),
  userAgent: varchar("user_agent", { length: 400 }),
  origem: varchar("origem", { length: 20 }).notNull().default("tornar-criador"),
}, (t) => [
  index("creator_terms_acceptances_user_idx").on(t.userId),
]);

export type CreatorTermsAcceptance = typeof creatorTermsAcceptancesTable.$inferSelect;
