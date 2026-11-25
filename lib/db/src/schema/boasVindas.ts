import { pgTable, serial, integer, text, boolean, timestamp, varchar, index, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { messagesTable } from "./messages";

/**
 * Mensagem automática de boas-vindas: UMA configuração por criadora (texto e/ou imagem). Só vale para NOVOS seguidores
 * (cada envio guarda o texto e a imagem do momento em que a pessoa começou a seguir). Ver lib/boasVindas.ts e docs/deploy/boas-vindas.md.
 */
export const boasVindasConfigTable = pgTable("boas_vindas_config", {
  criadoraId: integer("criadora_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  texto: text("texto").notNull().default(""),
  /** 'nenhuma' | 'imagem' (o vídeo fica para um PR próprio). */
  midiaTipo: varchar("midia_tipo", { length: 10 }).notNull().default("nenhuma"),
  /** URL canónico do CDN, guardado UMA vez; todas as mensagens apontam para o mesmo URL. */
  midiaUrl: text("midia_url"),
  ativa: boolean("ativa").notNull().default(false),
  /** Desativada por um admin (com motivo): a criadora não a reativa; o envio pára. */
  desativadaAdminEm: timestamp("desativada_admin_em"),
  desativadaAdminPor: integer("desativada_admin_por").references(() => usersTable.id, { onDelete: "set null" }),
  desativadaAdminMotivo: text("desativada_admin_motivo"),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
  atualizadoEm: timestamp("atualizado_em").notNull().defaultNow(),
}, (t) => [
  check("boas_vindas_config_texto_chk", sql`char_length(${t.texto}) <= 1000`),
  check("boas_vindas_config_midia_chk", sql`${t.midiaTipo} IN ('nenhuma', 'imagem') AND ((${t.midiaTipo} = 'nenhuma') = (${t.midiaUrl} IS NULL))`),
  check("boas_vindas_config_conteudo_chk", sql`${t.ativa} = false OR ${t.texto} <> '' OR ${t.midiaTipo} <> 'nenhuma'`),
]);

/**
 * Um envio por par criadora–seguidor, PARA SEMPRE (restrição única): refazer o seguir não reenvia. A linha é também a fila
 * (estado 'pendente') e o registo do resultado, sem dados pessoais (só o código do motivo).
 */
export const boasVindasEnviosTable = pgTable("boas_vindas_envios", {
  id: serial("id").primaryKey(),
  criadoraId: integer("criadora_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  seguidorId: integer("seguidor_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  /** pendente | enviada | ignorada (não cumpre uma regra) | falhada (erros repetidos) | descartada (expirou ou deixou de seguir) */
  estado: varchar("estado", { length: 12 }).notNull().default("pendente"),
  motivo: varchar("motivo", { length: 40 }),
  tentativas: integer("tentativas").notNull().default(0),
  /** Cópia da configuração no momento do seguir. */
  texto: text("texto").notNull().default(""),
  midiaUrl: text("midia_url"),
  proximaEm: timestamp("proxima_em").notNull().defaultNow(),
  messageId: integer("message_id").references(() => messagesTable.id, { onDelete: "set null" }),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
  enviadoEm: timestamp("enviado_em"),
}, (t) => [
  unique("boas_vindas_envios_par_uq").on(t.criadoraId, t.seguidorId),
  index("boas_vindas_envios_pendentes_idx").on(t.proximaEm).where(sql`${t.estado} = 'pendente'`),
  index("boas_vindas_envios_seguidor_idx").on(t.seguidorId, t.enviadoEm).where(sql`${t.estado} = 'enviada'`),
  index("boas_vindas_envios_criadora_idx").on(t.criadoraId, t.enviadoEm).where(sql`${t.estado} = 'enviada'`),
  index("boas_vindas_envios_message_idx").on(t.messageId),
  check("boas_vindas_envios_estado_chk", sql`${t.estado} IN ('pendente', 'enviada', 'ignorada', 'falhada', 'descartada')`),
  check("boas_vindas_envios_par_chk", sql`${t.criadoraId} <> ${t.seguidorId}`),
]);

export type BoasVindasConfig = typeof boasVindasConfigTable.$inferSelect;
export type BoasVindasEnvio = typeof boasVindasEnviosTable.$inferSelect;
