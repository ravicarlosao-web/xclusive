import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod/v4";
import { and, eq } from "drizzle-orm";
import { db, reportsTable, auditLogTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../lib/auth";
import { validate } from "../lib/validate";
import {
  TARGET_TYPES, REPORT_REASONS, TARGET_LABEL, REPORTS_CONTACT_EMAIL,
  lerAlvo, retirarAlvo, notificarSistema, TakedownError, type TargetType,
} from "../lib/takedown";

/**
 * Denúncias (utilizadores com conta e canal público sem conta).
 *  - POST /reports          (sessão)      — qualquer utilizador denuncia post, reel, story, comentário, perfil ou live
 *  - POST /reports/public   (sem sessão)  — direitos de autor / conteúdo não consentido / menor; contacto obrigatório
 *  - GET  /reports/contact                — e-mail de contacto (REPORTS_CONTACT_EMAIL)
 * Um só denunciante por alvo (índice único), auto-denúncia recusada, alvo validado, limite de taxa.
 * Categoria 'menor': denúncia urgente e, se feita com sessão, o conteúdo é retirado de imediato (escondido,
 * nada apagado) enquanto aguarda análise. O IP da rota pública fica só na BD, nunca em logs.
 */
const router = Router();

const limiteUtilizador = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: "Demasiadas denúncias num curto espaço de tempo. Tenta novamente mais tarde." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ((req as AuthRequest).userId ? `user:${(req as AuthRequest).userId}` : ipKeyGenerator(req.ip ?? "")),
});

const limitePublico = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: "Demasiadas denúncias a partir deste endereço. Tenta novamente mais tarde." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
});

const base = {
  targetType: z.enum(TARGET_TYPES),
  targetId: z.number().int().positive(),
};

const reportSchema = z.object({
  ...base,
  reason: z.enum(REPORT_REASONS),
  description: z.string().trim().max(1000).optional(),
}).refine((d) => d.reason !== "outro" || (d.description && d.description.length >= 5), {
  message: "Descreve o problema (mínimo 5 caracteres).",
  path: ["description"],
});

const publicSchema = z.object({
  ...base,
  reason: z.enum(["direitos_autor", "sem_consentimento", "menor"]),
  description: z.string().trim().min(20, "Descreve o problema (mínimo 20 caracteres).").max(1000),
  contactoEmail: z.email("E-mail inválido").max(255),
  declaracao: z.literal(true, { error: "É necessário confirmar a declaração." }),
});

/** Cria a denúncia na transação do chamador, validando o alvo; devolve os dados para a resposta. */
async function criarDenuncia(opts: {
  reporterId: number | null;
  targetType: TargetType;
  targetId: number;
  reason: string;
  description?: string;
  contacto?: string;
  ip?: string | null;
  autoRetirar: boolean;
}): Promise<{ id: number; retiradoAuto: boolean }> {
  return db.transaction(async (tx) => {
    const alvo = await lerAlvo(tx, opts.targetType, opts.targetId);
    // Conteúdo inexistente ou já retirado: mesma resposta (não revela o estado interno).
    if (!alvo || alvo.removido) throw new TakedownError("Conteúdo indisponível.", 404);
    if (opts.reporterId !== null && alvo.ownerId === opts.reporterId) {
      throw new TakedownError("Não podes denunciar o teu próprio conteúdo.", 400);
    }

    const urgente = opts.reason === "menor";
    const [rep] = await tx.insert(reportsTable).values({
      reporterId: opts.reporterId,
      targetType: opts.targetType,
      targetId: opts.targetId,
      targetOwnerId: alvo.ownerId,
      reason: opts.reason,
      description: opts.description || null,
      urgente,
      reporterContact: opts.contacto ?? null,
      reporterIp: opts.ip ?? null,
    }).returning({ id: reportsTable.id });

    // Menor: retirada automática imediata (esconde, não apaga) — só com sessão (denunciante identificável)
    // e nunca para perfis (suspender uma conta por uma única denúncia é abusável: fica na fila urgente).
    let retiradoAuto = false;
    if (urgente && opts.autoRetirar && opts.reporterId !== null && opts.targetType !== "user") {
      const r = await retirarAlvo(tx, opts.targetType, opts.targetId, null, "Retirado automaticamente por denúncia de menor (a aguardar análise).");
      retiradoAuto = r.mudou;
      if (r.mudou) {
        await notificarSistema(tx, alvo.ownerId, `O teu ${TARGET_LABEL[opts.targetType]} foi retirado temporariamente e está em análise pela equipa.`);
        await tx.insert(auditLogTable).values({
          adminId: opts.reporterId, action: "conteudo_retirado_auto", targetType: opts.targetType, targetId: opts.targetId,
          details: { reportId: rep.id, motivo: "menor" },
        });
      }
    }
    return { id: rep.id, retiradoAuto };
  });
}

function tratarErro(err: unknown, res: import("express").Response, log: { error: (...a: any[]) => void } | undefined): void {
  if (err instanceof TakedownError) { res.status(err.httpStatus).json({ error: err.message }); return; }
  const code = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
  if (code === "23505") { res.status(409).json({ error: "Já denunciaste este conteúdo." }); return; }
  log?.error({ err }, "Erro ao criar denúncia");
  res.status(500).json({ error: "Erro interno." });
}

router.post("/reports", requireAuth, limiteUtilizador, validate(reportSchema), async (req: AuthRequest, res): Promise<void> => {
  const { targetType, targetId, reason, description } = req.body as z.infer<typeof reportSchema>;
  try {
    const r = await criarDenuncia({ reporterId: req.userId!, targetType, targetId, reason, description, autoRetirar: true });
    res.status(201).json({ id: r.id, retiradoTemporariamente: r.retiradoAuto });
  } catch (err) {
    tratarErro(err, res, req.log);
  }
});

router.post("/reports/public", limitePublico, validate(publicSchema), async (req, res): Promise<void> => {
  const { targetType, targetId, reason, description, contactoEmail } = req.body as z.infer<typeof publicSchema>;
  try {
    await criarDenuncia({
      reporterId: null, targetType, targetId, reason, description,
      contacto: contactoEmail.trim().toLowerCase(), ip: (req.ip ?? "").slice(0, 45) || null, autoRetirar: false,
    });
    // Resposta genérica: não devolve ids nem confirma o estado interno do conteúdo.
    res.status(201).json({ ok: true });
  } catch (err) {
    if (err instanceof TakedownError && err.httpStatus === 404) { res.status(404).json({ error: "Conteúdo não encontrado." }); return; }
    tratarErro(err, res, (req as any).log);
  }
});

router.get("/reports/contact", (_req, res): void => {
  res.json({ email: REPORTS_CONTACT_EMAIL });
});

export default router;
