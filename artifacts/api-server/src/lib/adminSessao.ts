import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { verifyToken } from "./auth.js";

/** Inatividade máxima de uma sessão de admin: sem pedidos durante este tempo, o token deixa de valer (o painel volta ao login). */
export const INATIVIDADE_ADMIN_MIN = 10;

/**
 * A sessão de admin do token (jti) existe, é deste utilizador, não passou da expiração absoluta nem da inatividade. Se vale, renova o último uso
 * (no máximo uma escrita por 30 s). O poder de admin só vem de tokens do LOGIN DE ADMIN: um token do login normal, mesmo de uma conta admin, não tem sessão aqui.
 */
export async function sessaoAdminViva(jti: string | undefined, userId: number): Promise<boolean> {
  if (!jti) return false;
  const viva = await db.execute(sql`update admin_sessoes set ultimo_uso = case when ultimo_uso <= now() - interval '30 seconds' then now() else ultimo_uso end
    where jti = ${jti} and user_id = ${userId} and expira_em > now() and ultimo_uso > now() - make_interval(mins => ${INATIVIDADE_ADMIN_MIN}) returning 1`);
  return viva.rows.length > 0;
}

/** Para as rotas NORMAIS que dão um poder de moderação a admins (ex.: terminar a live de outra pessoa): o pedido traz um token de admin com sessão viva? Falha da BD = não. */
export async function pedidoComSessaoAdmin(authorization: string | undefined): Promise<boolean> {
  if (!authorization?.startsWith("Bearer ")) return false;
  try {
    const p = verifyToken(authorization.slice(7)) as { userId: number; jti?: string; type?: string; adm?: boolean };
    return p.type === "access" && p.adm === true && (await sessaoAdminViva(p.jti, p.userId));
  } catch { return false; }
}
