import { pgTable, serial, integer, text, varchar, timestamp, jsonb, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { reportsTable } from "./admin";

/**
 * Registo interno de casos de menor (um por conta). aberto → confirmado | arquivado.
 * Todas as FK são RESTRICT e um gatilho recusa DELETE (o registo conserva-se; `decisao_em` é a âncora do prazo).
 * `acessos_preservados`: IP e user-agent das sessões, copiados ANTES de a suspensão as apagar (dados pessoais:
 * nunca em logs nem em respostas públicas). `acoes`: só contagens e marcadores.
 */
export const menorCasesTable = pgTable("menor_cases", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  reportId: integer("report_id").references(() => reportsTable.id, { onDelete: "restrict" }),
  abertoEm: timestamp("aberto_em").notNull().defaultNow(),
  abertoPor: integer("aberto_por").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  descricao: text("descricao").notNull(),
  /** aberto | confirmado | arquivado */
  estado: varchar("estado", { length: 20 }).notNull().default("aberto"),
  decisaoEm: timestamp("decisao_em"),
  decisaoPor: integer("decisao_por").references(() => usersTable.id, { onDelete: "restrict" }),
  decisaoMotivo: text("decisao_motivo"),
  acoes: jsonb("acoes").notNull().default(sql`'{}'::jsonb`),
  acessosPreservados: jsonb("acessos_preservados").notNull().default(sql`'[]'::jsonb`),
  autoridade: varchar("autoridade", { length: 150 }),
  autoridadeComunicadaEm: timestamp("autoridade_comunicada_em"),
  autoridadeReferencia: varchar("autoridade_referencia", { length: 100 }),
  autoridadeRegistadaPor: integer("autoridade_registada_por").references(() => usersTable.id, { onDelete: "restrict" }),
}, (t) => [
  uniqueIndex("menor_cases_um_ativo").on(t.userId).where(sql`${t.estado} IN ('aberto', 'confirmado')`),
  index("menor_cases_estado_idx").on(t.estado, t.abertoEm),
  index("menor_cases_report_idx").on(t.reportId),
  check("menor_cases_estado_chk", sql`${t.estado} IN ('aberto', 'confirmado', 'arquivado')`),
  check("menor_cases_decisao_chk", sql`(${t.estado} = 'aberto') = (${t.decisaoEm} IS NULL)`),
  check("menor_cases_autoridade_chk", sql`${t.autoridade} IS NULL OR ${t.autoridadeComunicadaEm} IS NOT NULL`),
]);

export type MenorCase = typeof menorCasesTable.$inferSelect;
