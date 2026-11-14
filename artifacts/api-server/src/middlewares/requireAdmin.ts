import type { Request, Response, NextFunction } from "express";
import { eq, sql } from "drizzle-orm";
import { db, usersTable, revokedTokensTable } from "@workspace/db";
import { verifyToken, emitidoAntesDaAlteracao } from "../lib/auth.js";

export interface AdminRequest extends Request {
  adminId?: number;
  adminUsername?: string;
  adminRole?: string;
  /** Marca de que este pedido já passou pela verificação (o router e a rota aplicam o middleware duas vezes). */
  adminVerificado?: boolean;
}

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
/** Inatividade máxima de uma sessão de admin: sem pedidos durante este tempo, o token deixa de valer (o painel volta ao login). */
export const INATIVIDADE_ADMIN_MIN = 10;
/** Código do 403 enquanto a troca de palavra-passe é obrigatória (o painel leva o admin ao formulário de troca). */
export const CODIGO_TROCA_OBRIGATORIA = "troca_password_obrigatoria";

/**
 * Middleware que protege todas as rotas /api/admin/*.
 *  1. JWT válido (assinatura e expiração) do tipo ACESSO: um refresh token nunca serve aqui;
 *  2. a role do token é de administração;
 *  3. a cada pedido confirma na BD que o utilizador existe, está ativo, não está encerrado nem banido e que a role ATUAL é
 *     admin ou superadmin (um admin despromovido, suspenso ou banido perde o acesso ao pedido seguinte);
 *  4. o token (jti) não está em revoked_tokens (o mesmo mecanismo de sessões revogadas dos utilizadores);
 *  5. os tokens emitidos pelo login de admin (marca `adm`) têm uma linha em admin_sessoes e expiram por inatividade (INATIVIDADE_ADMIN_MIN);
 *     a mesma instrução confirma e renova o último uso (no máximo uma escrita por 30 s). Tokens sem a marca não são afetados.
 * A role usada pelas rotas (adminRole) é a da BD, não a do token. Falha de BD = negar (fail-closed, 503).
 */
export async function requireAdmin(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  if (req.adminVerificado) { next(); return; }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Não autenticado" });
    return;
  }

  let payload: { userId: number; username: string; role?: string; type?: string; jti?: string; adm?: boolean };
  try {
    payload = verifyToken(authHeader.slice(7)) as typeof payload;
  } catch {
    res.status(401).json({ error: "Token inválido" });
    return;
  }

  // Só access tokens (os refresh tokens vivem 7 dias e só servem em /auth/refresh)
  if (payload.type !== "access") {
    res.status(401).json({ error: "Token inválido" });
    return;
  }
  if (!payload.role || !ADMIN_ROLES.has(payload.role)) {
    res.status(403).json({ error: "Acesso negado — conta sem permissões de administrador" });
    return;
  }

  try {
    const [revogados, contas] = await Promise.all([
      payload.jti
        ? db.select({ jti: revokedTokensTable.jti }).from(revokedTokensTable).where(eq(revokedTokensTable.jti, payload.jti)).limit(1)
        : Promise.resolve([] as { jti: string }[]),
      db.select({ ativo: usersTable.ativo, role: usersTable.role, encerradaEm: usersTable.encerradaEm, banidaEm: usersTable.banidaEm, passwordAlteradaEm: usersTable.passwordAlteradaEm, trocaObrigatoria: usersTable.trocaPasswordObrigatoria })
        .from(usersTable).where(eq(usersTable.id, payload.userId)).limit(1),
    ]);
    if (revogados[0]) {
      res.status(401).json({ error: "Sessão terminada. Faz login novamente." });
      return;
    }
    if (payload.adm === true) {
      const viva = await db.execute(sql`update admin_sessoes set ultimo_uso = case when ultimo_uso <= now() - interval '30 seconds' then now() else ultimo_uso end
        where jti = ${payload.jti ?? ""} and user_id = ${payload.userId} and expira_em > now() and ultimo_uso > now() - make_interval(mins => ${INATIVIDADE_ADMIN_MIN}) returning 1`);
      if (viva.rows.length === 0) {
        res.status(401).json({ error: "Sessão terminada. Faz login novamente.", codigo: "sessao_terminada" });
        return;
      }
    }
    const conta = contas[0];
    // Palavra-passe alterada depois de este token ter sido emitido.
    if (conta && emitidoAntesDaAlteracao((payload as { iat?: number }).iat, conta.passwordAlteradaEm)) {
      res.status(401).json({ error: "Sessão terminada. Faz login novamente.", codigo: "sessao_terminada" });
      return;
    }
    if (conta && !conta.ativo && (conta.encerradaEm || conta.banidaEm)) {
      res.status(401).json({ error: "Conta encerrada.", codigo: "conta_encerrada" });
      return;
    }
    if (!conta || !conta.ativo) {
      res.status(401).json({ error: "Conta suspensa ou não encontrada." });
      return;
    }
    if (!ADMIN_ROLES.has(conta.role)) {
      res.status(403).json({ error: "Acesso negado — conta sem permissões de administrador" });
      return;
    }
    // Troca de palavra-passe obrigatória: enquanto a marca estiver ativa, a sessão só serve para trocar a palavra-passe (POST /admin/auth/password).
    // O logout do admin é local (o painel apaga a sessão) e o /auth/logout não passa por aqui; o login não passa por este middleware.
    if (conta.trocaObrigatoria && !(req.method === "POST" && req.originalUrl.split("?")[0].replace(/\/+$/, "").endsWith("/admin/auth/password"))) {
      res.status(403).json({ error: "Troca de palavra-passe obrigatória.", codigo: CODIGO_TROCA_OBRIGATORIA });
      return;
    }
    req.adminRole = conta.role;
  } catch (err) {
    (req as any).log?.warn({ err: err instanceof Error ? err.name : "erro" }, "DB indisponível durante verificação de admin — a negar pedido (fail-closed)");
    res.status(503).json({ error: "Serviço temporariamente indisponível." });
    return;
  }

  req.adminId = payload.userId;
  req.adminUsername = payload.username;
  req.adminVerificado = true;
  next();
}
