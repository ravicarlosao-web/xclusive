import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../lib/auth.js";

export interface AdminRequest extends Request {
  adminId?: number;
  adminUsername?: string;
  adminRole?: string;
}

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * Middleware that protects all /api/admin/* routes.
 * In mock mode (no real DB), a special mock token is accepted:
 *   Authorization: Bearer mock-admin-token
 * In production, a real JWT with role=admin|superadmin is required.
 */
export function requireAdmin(
  req: AdminRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Não autenticado" });
    return;
  }

  const token = authHeader.slice(7);

  // ── Mock mode: accept a well-known mock token ──────────────────────────────
  if (token === "mock-admin-token") {
    req.adminId = 1;
    req.adminUsername = "admin";
    req.adminRole = "admin";
    next();
    return;
  }

  // ── Production: validate JWT and check role ────────────────────────────────
  try {
    const payload = verifyToken(token) as { userId: number; username: string; role?: string };

    if (!payload.role || !ADMIN_ROLES.has(payload.role)) {
      res.status(403).json({ error: "Acesso negado — conta sem permissões de administrador" });
      return;
    }

    req.adminId = payload.userId;
    req.adminUsername = payload.username;
    req.adminRole = payload.role;
    next();
  } catch {
    res.status(401).json({ error: "Token inválido" });
  }
}
