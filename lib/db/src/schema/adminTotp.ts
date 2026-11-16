import { pgTable, serial, integer, varchar, text, bigint, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Autenticação em dois passos (TOTP, RFC 6238) das contas de admin e superadmin. Uma linha por conta (user_id único).
 *   segredo_cifrado / iv / tag   o segredo TOTP cifrado com AES-256-GCM (base64); NUNCA em texto simples. A autenticação (tag) é verificada ao decifrar.
 *   chave_versao                 identificador da chave de cifra (ex.: «v1»): só o formato, para permitir rodar a chave no futuro (ADMIN_TOTP_CHAVE)
 *   ativado_em                   NULL = ativação pendente (expira 10 min depois de criado_em); preenchido = TOTP ativo
 *   ultimo_passo_usado           último passo de tempo (30 s) aceite: um código desse passo ou de um anterior é recusado (anti-repetição)
 * FK RESTRICT para users (como as tabelas financeiras): uma conta com TOTP não se apaga por cascata.
 */
export const adminTotpTable = pgTable("admin_totp", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique().references(() => usersTable.id, { onDelete: "restrict" }),
  segredoCifrado: text("segredo_cifrado").notNull(),
  iv: varchar("iv", { length: 64 }).notNull(),
  tag: varchar("tag", { length: 64 }).notNull(),
  chaveVersao: varchar("chave_versao", { length: 16 }).notNull(),
  ativadoEm: timestamp("ativado_em"),
  ultimoPassoUsado: bigint("ultimo_passo_usado", { mode: "number" }),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});

/**
 * Códigos de recuperação (10 por conta): guardados SÓ como hash bcrypt (o mesmo das palavras-passe), de uso único (`usado_em`), mostrados uma só vez.
 */
export const adminTotpRecuperacaoTable = pgTable("admin_totp_recuperacao", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  codigoHash: varchar("codigo_hash", { length: 100 }).notNull(),
  usadoEm: timestamp("usado_em"),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
}, (t) => [index("admin_totp_recuperacao_user_idx").on(t.userId)]);
