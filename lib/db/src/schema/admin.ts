import {
  pgTable,
  serial,
  integer,
  text,
  varchar,
  timestamp,
  numeric,
  jsonb,
  primaryKey,
  boolean,
  pgEnum,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

// ─── reports ────────────────────────────────────────────────────────────────

export const reportStatusEnum = pgEnum("report_status", ["pendente", "em_analise", "procedente", "improcedente"]);
export const reportTargetEnum = pgEnum("report_target_type", ["post", "reel", "story", "comment", "user", "live"]);

/**
 * Denúncias de conteúdo. Máquina de estados rígida (routes/admin.ts, sob FOR UPDATE):
 *   pendente → em_analise → procedente | improcedente      pendente → procedente | improcedente
 * (procedente e improcedente são finais). O texto do denunciante (`description`) é IMUTÁVEL;
 * as notas do admin ficam em `admin_notes`. Denunciante: utilizador (`reporter_id`) ou, na rota
 * pública, só um contacto (`reporter_contact`).
 */
export const reportsTable = pgTable("reports", {
  id: serial("id").primaryKey(),
  reporterId: integer("reporter_id").references(() => usersTable.id, { onDelete: "set null" }),
  targetType: reportTargetEnum("target_type").notNull(),
  targetId: integer("target_id").notNull(),
  /** Autor/dono do alvo no momento da denúncia (para avisar/suspender sem reler o alvo). */
  targetOwnerId: integer("target_owner_id").references(() => usersTable.id, { onDelete: "set null" }),
  reason: varchar("reason", { length: 50 }).notNull(), // 'menor' | 'sem_consentimento' | 'direitos_autor' | 'violencia' | 'assedio' | 'spam' | 'outro'
  description: text("description"),
  /** Denúncia prioritária (categoria 'menor'): fila própria no admin. */
  urgente: boolean("urgente").notNull().default(false),
  status: reportStatusEnum("status").notNull().default("pendente"),
  /** Notas internas do admin (nunca sobrescrevem o texto do denunciante). */
  adminNotes: text("admin_notes"),
  acaoRetirou: boolean("acao_retirou").notNull().default(false),
  acaoSuspendeu: boolean("acao_suspendeu").notNull().default(false),
  /**
   * Cópia leve do alvo no momento da denúncia (tipo, texto, chaves dos ficheiros, dono, datas): sobrevive a um
   * apagamento posterior do conteúdo. Só o admin a lê; nunca em logs nem em rotas públicas.
   */
  alvoSnapshot: jsonb("alvo_snapshot"),
  /** Só na rota pública (sem conta): contacto e IP (apenas na BD; nunca em logs). */
  reporterContact: varchar("reporter_contact", { length: 255 }),
  reporterIp: varchar("reporter_ip", { length: 45 }),
  resolvedBy: integer("resolved_by").references(() => usersTable.id, { onDelete: "set null" }),
  resolvedAt: timestamp("resolved_at"),
  /** Marcadores de escalada de urgentes (lib/reportEscalation.ts): garantem um único aviso por nível. */
  escalada1hEm: timestamp("escalada_1h_em"),
  escalada24hEm: timestamp("escalada_24h_em"),
  /** Preenchido quando o alerta externo (webhook) foi entregue com sucesso; o job reenvia os que faltam. */
  alertaExternoEm: timestamp("alerta_externo_em"),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
}, (t) => [
  // Um só denunciante por alvo (utilizador com conta, ou contacto na rota pública).
  uniqueIndex("reports_um_por_utilizador").on(t.reporterId, t.targetType, t.targetId).where(sql`${t.reporterId} IS NOT NULL`),
  index("reports_alvo_estado_idx").on(t.targetType, t.targetId, t.status),
  uniqueIndex("reports_um_por_contacto").on(t.reporterContact, t.targetType, t.targetId).where(sql`${t.reporterId} IS NULL AND ${t.reporterContact} IS NOT NULL`),
]);

export type Report = typeof reportsTable.$inferSelect;

// ─── withdrawal_requests ─────────────────────────────────────────────────────

export const withdrawalStatusEnum = pgEnum("withdrawal_status", ["pendente", "aprovado", "rejeitado", "pago", "retido"]);

/**
 * Pedidos de levantamento. Máquina de estados rígida (aplicada em routes/admin.ts, sob FOR UPDATE):
 *   pendente → aprovado → pago      pendente → rejeitado      (pago e rejeitado são finais)
 *   pendente | aprovado → retido → aprovado | rejeitado   (retenção do Art. 6.º dos Termos para Criadoras; o retido não vai a pago)
 * Os ganhos são debitados ao criar o pedido (reserva) e devolvidos UMA vez, na rejeição (nunca enquanto está retido).
 */
export const withdrawalRequestsTable = pgTable("withdrawal_requests", {
  id: serial("id").primaryKey(),
  creatorId: integer("creator_id")
    .notNull()
    .references(() => usersTable.id),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  method: varchar("method", { length: 30 }).notNull(), // 'transferencia_bancaria'
  /** Cópia do IBAN/titular/banco no momento do pedido (nunca em listagens nem logs). */
  destinationDetails: jsonb("destination_details"),
  status: withdrawalStatusEnum("status").notNull().default("pendente"),
  processedBy: integer("processed_by").references(() => usersTable.id),
  processedAt: timestamp("processed_at"),
  notes: text("notes"),
  /** Retenção (Art. 6.º): quando, por quem e porquê. O motivo é interno; `retidoMotivoVisivel=false` esconde-o à criadora. */
  retidoEm: timestamp("retido_em"),
  retidoPor: integer("retido_por").references(() => usersTable.id, { onDelete: "set null" }),
  retidoMotivo: text("retido_motivo"),
  retidoMotivoVisivel: boolean("retido_motivo_visivel").notNull().default(true),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
}, (t) => [
  // Um só pedido pendente por criadora (clique duplo = conflito).
  uniqueIndex("withdrawal_requests_um_pendente").on(t.creatorId).where(sql`${t.status} = 'pendente'`),
]);

/** Dados de pagamento da criadora (uma conta por criadora). */
export const creatorPayoutAccountsTable = pgTable("creator_payout_accounts", {
  userId: integer("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  iban: varchar("iban", { length: 34 }).notNull(),
  nomeTitular: varchar("nome_titular", { length: 150 }).notNull(),
  banco: varchar("banco", { length: 100 }).notNull(),
  atualizadoEm: timestamp("atualizado_em").notNull().defaultNow(),
});

export type WithdrawalRequest = typeof withdrawalRequestsTable.$inferSelect;

// ─── audit_log ───────────────────────────────────────────────────────────────

export const auditLogTable = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  adminId: integer("admin_id")
    .notNull()
    .references(() => usersTable.id),
  action: varchar("action", { length: 60 }).notNull(), // 'user_suspend' | 'user_delete' | 'withdrawal_approve' | etc.
  targetType: varchar("target_type", { length: 30 }),
  targetId: integer("target_id"),
  details: jsonb("details"),
  ipAddress: varchar("ip_address", { length: 45 }),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});

export type AuditLog = typeof auditLogTable.$inferSelect;

// ─── infracoes_mais18 ────────────────────────────────────────────────────────

/**
 * Infrações da regra do +18: o admin marcou como +18 conteúdo que a criadora não tinha marcado.
 * Uma infração ATIVA por conteúdo (índice único parcial). `numero` = infrações ativas da criadora depois desta.
 * 1.ª e 2.ª = aviso; da 3.ª em diante = suspensão (lib/infracoesMais18.ts). Anular = preencher `anulada_*`.
 */
export const infracoesMais18Table = pgTable("infracoes_mais18", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  tipoConteudo: varchar("tipo_conteudo", { length: 10 }).notNull(), // 'post' | 'reel' | 'story' | 'live'
  conteudoId: integer("conteudo_id").notNull(),
  adminId: integer("admin_id").notNull().references(() => usersTable.id),
  reportId: integer("report_id").references(() => reportsTable.id, { onDelete: "set null" }),
  origem: varchar("origem", { length: 10 }).notNull(), // 'admin' | 'denuncia'
  numero: integer("numero").notNull(),
  acao: varchar("acao", { length: 10 }).notNull(), // 'aviso' | 'suspensao'
  motivo: text("motivo"),
  criadaEm: timestamp("criada_em").notNull().defaultNow(),
  anuladaEm: timestamp("anulada_em"),
  anuladaPor: integer("anulada_por").references(() => usersTable.id),
  anuladaMotivo: text("anulada_motivo"),
}, (t) => [
  uniqueIndex("infracoes_mais18_uma_ativa_por_conteudo").on(t.tipoConteudo, t.conteudoId).where(sql`${t.anuladaEm} IS NULL`),
]);

export type InfracaoMais18 = typeof infracoesMais18Table.$inferSelect;

// ─── topup_requests ──────────────────────────────────────────────────────────

export const topupRequestsTable = pgTable("topup_requests", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  reference: varchar("reference", { length: 20 }).notNull().unique(),
  /**
   * Status do pedido:
   *   pendente            — comprovativo manual, aguarda revisão do admin
   *   processando         — AppyPay GPO: cobrança enviada, aguarda confirmação no telemóvel
   *   aguardando_pagamento — AppyPay REF: referência gerada, aguarda pagamento pelo utilizador
   *   aprovado            — saldo creditado (manual ou via webhook)
   *   rejeitado           — negado/expirado (manual ou via webhook)
   */
  status: varchar("status", { length: 30 }).notNull().default("pendente"),
  /** Método de pagamento: 'manual' | 'gpo' | 'ref' */
  paymentMethod: varchar("payment_method", { length: 10 }).notNull().default("manual"),
  /** ID do charge no AppyPay (para lookup no webhook e verificação dupla) */
  externalChargeId: varchar("external_charge_id", { length: 120 }),
  /**
   * Dados extra do AppyPay:
   *   REF: { entity, referenceNumber, dueDate }
   *   GPO: null (confirmação via webhook)
   */
  externalRef: jsonb("external_ref"),
  comprovantivoBase64: text("comprovativo_base64"),
  comprovantivoNome: varchar("comprovativo_nome", { length: 255 }),
  processadoPor: integer("processado_por").references(() => usersTable.id),
  processadoEm: timestamp("processado_em"),
  notas: text("notas"),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});

export type TopupRequest = typeof topupRequestsTable.$inferSelect;

// ─── platform_settings ───────────────────────────────────────────────────────

export const platformSettingsTable = pgTable("platform_settings", {
  key: varchar("key", { length: 60 }).primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: integer("updated_by").references(() => usersTable.id),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type PlatformSetting = typeof platformSettingsTable.$inferSelect;
