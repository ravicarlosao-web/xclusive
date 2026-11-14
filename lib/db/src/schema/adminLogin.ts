import { pgTable, varchar, integer, timestamp, primaryKey, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Proteção do login de admin (POST /admin/auth/login), persistida na BD para sobreviver a reinícios do processo.
 * Uma linha por (tipo, chave): tipo 'conta' (chave = SHA-256 do email normalizado, nunca o email) ou 'ip' (chave = IP do pedido).
 *   falhas        falhas seguidas na janela atual (a janela abre na primeira falha e dura 15 min)
 *   bloqueado_ate enquanto for futuro, a conta/IP está bloqueado (mesmo com a palavra-passe certa)
 *   nivel         quantos bloqueios seguidos (escalada: 15, 30, 60, 120 e 240 min no máximo); volta a 0 após 24 h sem falhas
 */
export const adminLoginControloTable = pgTable("admin_login_controlo", {
  tipo: varchar("tipo", { length: 5 }).notNull(),
  chave: varchar("chave", { length: 64 }).notNull(),
  falhas: integer("falhas").notNull().default(0),
  janelaInicio: timestamp("janela_inicio").notNull().defaultNow(),
  bloqueadoAte: timestamp("bloqueado_ate"),
  nivel: integer("nivel").notNull().default(0),
  atualizadoEm: timestamp("atualizado_em").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tipo, t.chave] }), index("admin_login_controlo_atualizado_idx").on(t.atualizadoEm)]);

/**
 * Sessões de admin (uma por login): permitem expirar por inatividade. O token leva a marca `adm` e o jti desta linha;
 * `ultimo_uso` avança a cada pedido autenticado (no máximo uma escrita por 30 s). Tokens sem a marca (anteriores) não são afetados.
 */
export const adminSessoesTable = pgTable("admin_sessoes", {
  jti: varchar("jti", { length: 64 }).primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  criadaEm: timestamp("criada_em").notNull().defaultNow(),
  ultimoUso: timestamp("ultimo_uso").notNull().defaultNow(),
  expiraEm: timestamp("expira_em").notNull(),
}, (t) => [index("admin_sessoes_expira_idx").on(t.expiraEm)]);
