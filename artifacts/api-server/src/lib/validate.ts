import { z } from "zod/v4";
import type { Request, Response, NextFunction } from "express";

/**
 * Middleware de validação Zod.
 * Substitui req[target] pelo valor parsed (com coercions/defaults aplicados).
 * Responde 400 com lista de erros detalhada se a validação falhar.
 */
export function validate<T extends z.ZodTypeAny>(
  schema: T,
  target: "body" | "query" | "params" = "body",
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      res.status(400).json({
        error: "Dados inválidos",
        details: result.error.issues.map((i) => ({
          campo: i.path.join("."),
          mensagem: i.message,
        })),
      });
      return;
    }
    // Substitui pelo valor validado (com defaults e transformações)
    (req as any)[target] = result.data;
    next();
  };
}
