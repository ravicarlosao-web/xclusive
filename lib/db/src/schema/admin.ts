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
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// ─── reports ────────────────────────────────────────────────────────────────

export const reportsTable = pgTable("reports", {
  id: serial("id").primaryKey(),
  reporterId: integer("reporter_id").references(() => usersTable.id),
  targetType: varchar("target_type", { length: 20 }).notNull(), // 'post' | 'comment' | 'user' | 'message'
  targetId: integer("target_id").notNull(),
  reason: varchar("reason", { length: 50 }).notNull(), // 'nudity_minor' | 'spam' | 'harassment' | 'copyright' | 'other'
  description: text("description"),
  status: varchar("status", { length: 20 }).notNull().default("pending"), // 'pending' | 'reviewing' | 'resolved' | 'dismissed'
  resolvedBy: integer("resolved_by").references(() => usersTable.id),
  resolvedAt: timestamp("resolved_at"),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});

export type Report = typeof reportsTable.$inferSelect;

// ─── withdrawal_requests ─────────────────────────────────────────────────────

export const withdrawalRequestsTable = pgTable("withdrawal_requests", {
  id: serial("id").primaryKey(),
  creatorId: integer("creator_id")
    .notNull()
    .references(() => usersTable.id),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  method: varchar("method", { length: 30 }).notNull(), // 'bank_transfer' | 'multicaixa_express' | etc.
  destinationDetails: jsonb("destination_details"),
  status: varchar("status", { length: 20 }).notNull().default("pending"), // 'pending' | 'approved' | 'rejected' | 'paid'
  processedBy: integer("processed_by").references(() => usersTable.id),
  processedAt: timestamp("processed_at"),
  notes: text("notes"),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
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

// ─── platform_settings ───────────────────────────────────────────────────────

export const platformSettingsTable = pgTable("platform_settings", {
  key: varchar("key", { length: 60 }).primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: integer("updated_by").references(() => usersTable.id),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type PlatformSetting = typeof platformSettingsTable.$inferSelect;
