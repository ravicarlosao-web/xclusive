import { pgTable, serial, integer, text, boolean, timestamp, numeric, pgEnum } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const subscriptionEstadoEnum = pgEnum("subscription_estado", ["ativa", "cancelada"]);
export const purchaseTipoEnum = pgEnum("purchase_tipo", ["subscricao", "ppv", "gorjeta"]);

export const subscriptionPlansTable = pgTable("subscription_plans", {
  id: serial("id").primaryKey(),
  criadorId: integer("criador_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  nome: text("nome").notNull(),
  preco: numeric("preco", { precision: 10, scale: 2 }).notNull(),
  beneficios: text("beneficios"),
  ativo: boolean("ativo").notNull().default(true),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});

export const subscriptionsTable = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  subscriitorId: integer("subscritor_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  criadorId: integer("criador_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  planoId: integer("plano_id").references(() => subscriptionPlansTable.id, { onDelete: "set null" }),
  estado: subscriptionEstadoEnum("estado").notNull().default("ativa"),
  inicioEm: timestamp("inicio_em").notNull().defaultNow(),
  renovacaoEm: timestamp("renovacao_em"),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});

export const purchasesTable = pgTable("purchases", {
  id: serial("id").primaryKey(),
  compradorId: integer("comprador_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  vendedorId: integer("vendedor_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  tipo: purchaseTipoEnum("tipo").notNull(),
  valor: numeric("valor", { precision: 10, scale: 2 }).notNull(),
  conteudoId: integer("conteudo_id"),
  descricao: text("descricao"),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});

export type SubscriptionPlan = typeof subscriptionPlansTable.$inferSelect;
export type Subscription = typeof subscriptionsTable.$inferSelect;
export type Purchase = typeof purchasesTable.$inferSelect;
