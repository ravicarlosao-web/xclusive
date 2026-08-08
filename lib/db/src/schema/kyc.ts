import { integer, pgEnum, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
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
