import { and, eq, notInArray, sql } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

/**
 * REGRA ÚNICA das listagens e pesquisas públicas (sugestões, top criadores, pesquisa, Explorar, lives, histórias, seguidos…):
 * só aparecem contas CRIADORAS (tipo de conta criador) VERIFICADAS (KYC aprovado: uma criadora com o pedido por aprovar não aparece), ATIVAS (nem suspensas, nem encerradas, nem banidas: todas têm ativo = false)
 * e que NÃO sejam de administração (role admin ou superadmin, mesmo com tipo de conta criador).
 * Um só sítio: não se repetem estas condições nas rotas.
 */
export const ROLES_ADMIN = ["admin", "superadmin"] as const;

/** Condição Drizzle sobre `usersTable`: criadora, ativa e fora da administração. */
export const criadoresPublicos = () => and(eq(usersTable.tipoConta, "criador"), eq(usersTable.verificado, true), eq(usersTable.ativo, true), notInArray(usersTable.role, [...ROLES_ADMIN]));

/** Condição Drizzle sobre `usersTable`: conta ativa e fora da administração (listas de seguidores: aí os fãs são legítimos; admins nunca). */
export const contaVisivel = () => and(eq(usersTable.ativo, true), notInArray(usersTable.role, [...ROLES_ADMIN]));

/** SQL: a coluna (id de utilizador) é de uma criadora pública. Para filtrar listas que só têm o id (posts, lives, histórias…). */
export const criadorPublicoSql = (col: unknown) => sql`${col} IN (SELECT id FROM users WHERE tipo_conta = 'criador' AND ativo AND role NOT IN ('admin', 'superadmin'))`;

/** Esta conta é de administração? (para recusar o acesso direto como se não existisse) */
export const eContaAdmin = (u: { role?: string | null } | null | undefined): boolean => !!u && ROLES_ADMIN.includes((u.role ?? "") as typeof ROLES_ADMIN[number]);

/** A conta com este id é de administração? (uma leitura; para recusar gorjetas, subscrições e lives de contas admin como se não existissem) */
export async function idEContaAdmin(id: number | null | undefined, ex: { select: typeof db.select } = db): Promise<boolean> {
  if (id == null) return false;
  const [u] = await ex.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, id)).limit(1);
  return eContaAdmin(u);
}
