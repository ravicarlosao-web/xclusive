import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod/v4";
import { and, eq, gt, count, sql } from "drizzle-orm";
import { db, reportsTable, auditLogTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../lib/auth";
import { validate } from "../lib/validate";
import { enviarEMarcarAlerta, textoAlerta } from "../lib/alertaExterno";
import { bloquearAlvo } from "../lib/provaProtegida";
import { jsonCanonico, sha256Hex } from "../lib/hashCanonico";
import {
  TARGET_TYPES_GENERICOS, REPORT_REASONS, TARGET_LABEL, REPORTS_CONTACT_EMAIL,
  lerAlvo, retirarAlvo, notificarSistema, notificarAdmins, TakedownError, type TargetType,
} from "../lib/takedown";

/**
 * Denúncias (utilizadores com conta e canal público sem conta).
 *  - POST /reports          (sessão)      — qualquer utilizador denuncia post, story, comentário, perfil ou live
 *  - POST /reports/public   (sem sessão)  — direitos de autor / conteúdo não consentido / menor; contacto obrigatório
 *  - GET  /reports/contact                — e-mail de contacto (REPORTS_CONTACT_EMAIL)
 * Um só denunciante por alvo (índice único), auto-denúncia recusada, alvo validado, limite de taxa.
 * Categoria 'menor': denúncia urgente e o conteúdo é retirado de imediato (escondido, nada apagado) enquanto aguarda
 * análise: com sessão sempre; sem sessão até 3 retiradas automáticas por 24 h por IP e por contacto (contadas sobre os
 * dados que a denúncia já guarda; passado o limite a denúncia fica criada, urgente e com alerta, mas sem retirada).
 * Perfis nunca se suspendem nem retiram automaticamente: só alerta reforçado. O IP da rota pública fica só na BD, nunca em logs.
 */
const router = Router();

export const limiteUtilizador = rateLimit({
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
  targetType: z.enum(TARGET_TYPES_GENERICOS),
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

/** POST /conversations/:id/denunciar (a rota está em messages.ts, que valida a conversa e prepara a prova). */
export const denunciaMensagemSchema = z.object({
  mensagemId: z.number().int().positive(),
  motivo: z.enum(REPORT_REASONS.filter((r) => r !== "conteudo_mais18_nao_marcado") as unknown as [typeof REPORT_REASONS[number], ...typeof REPORT_REASONS[number][]]),
  descricao: z.string().trim().max(1000).optional(),
}).refine((d) => d.motivo !== "outro" || (d.descricao && d.descricao.length >= 5), {
  message: "Descreve o problema (mínimo 5 caracteres).",
  path: ["descricao"],
});

const LIMITE_RETIRADAS_PUBLICAS = 3;
const JANELA_MS = 24 * 60 * 60 * 1000;

/**
 * Limite das retiradas automáticas de denúncias públicas: no máximo 3 por 24 h por IP e por contacto. Conta as próprias
 * denúncias (reports.retirada_auto) sobre o IP e o contacto que elas já guardam: não se grava mais nada. Os locks
 * consultivos (ordenados) serializam denúncias simultâneas da mesma origem, para o limite não ser contornado em paralelo.
 */
async function dentroDoLimitePublico(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], ip: string | null, contacto: string | null): Promise<boolean> {
  const chaves = [ip ? `ip:${ip}` : null, contacto ? `email:${contacto}` : null].filter((k): k is string => k !== null).sort();
  for (const k of chaves) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"pubmenor:" + k}, 0))`);
  const desde = new Date(Date.now() - JANELA_MS);
  if (ip) {
    const [{ n }] = await tx.select({ n: count() }).from(reportsTable).where(and(eq(reportsTable.reporterIp, ip), eq(reportsTable.retiradaAuto, true), gt(reportsTable.criadoEm, desde)));
    if (Number(n) >= LIMITE_RETIRADAS_PUBLICAS) return false;
  }
  if (contacto) {
    const [{ n }] = await tx.select({ n: count() }).from(reportsTable).where(and(eq(reportsTable.reporterContact, contacto), eq(reportsTable.retiradaAuto, true), gt(reportsTable.criadoEm, desde)));
    if (Number(n) >= LIMITE_RETIRADAS_PUBLICAS) return false;
  }
  return true;
}

/** Cria a denúncia na transação do chamador, validando o alvo; devolve os dados para a resposta. */
export async function criarDenuncia(opts: {
  reporterId: number | null;
  targetType: TargetType;
  targetId: number;
  reason: string;
  description?: string;
  contacto?: string;
  ip?: string | null;
  autoRetirar: boolean;
  /** Denúncia pública (sem sessão): retirada automática sujeita aos limites por IP e por contacto. */
  autoRetirarPublico?: boolean;
  /** Só 'mensagem': id reservado e snapshot já preparado (janela de contexto + cópias das imagens). Os outros tipos usam o snapshot de sempre. */
  reportId?: number;
  snapshotPronto?: Record<string, unknown>;
}): Promise<{ id: number; retiradoAuto: boolean }> {
  const urgente = opts.reason === "menor";
  // Perfil denunciado por menor: nunca se suspende sozinho; o alerta sai reforçado (a equipa avalia abrir um caso).
  const perfil = urgente && opts.targetType === "user";
  const resultado = await db.transaction(async (tx) => {
    // Bloqueia a linha do alvo (FOR SHARE): uma eliminação concorrente espera por esta denúncia e vê-a (ou a denúncia
    // espera pela eliminação e o alvo já não existe).
    await bloquearAlvo(tx, opts.targetType, opts.targetId, "share");
    const alvo = await lerAlvo(tx, opts.targetType, opts.targetId);
    // Conteúdo inexistente ou já retirado: mesma resposta (não revela o estado interno).
    if (!alvo || alvo.removido) throw new TakedownError("Conteúdo indisponível.", 404);
    // "Conteúdo +18 não marcado": só faz sentido em post, story ou live que ainda NÃO está marcado.
    if (opts.reason === "conteudo_mais18_nao_marcado") {
      if (!["post", "story", "live"].includes(opts.targetType)) throw new TakedownError("Este motivo só se aplica a publicações, stories e lives.", 400);
      if (alvo.mais18) throw new TakedownError("Este conteúdo já está marcado como +18.", 409);
    }
    if (opts.reporterId !== null && alvo.ownerId === opts.reporterId) {
      throw new TakedownError("Não podes denunciar o teu próprio conteúdo.", 400);
    }

    // Cópia leve do alvo: sobrevive a um apagamento posterior. Só o admin a lê; nunca em logs nem em rotas públicas.
    const snapshot = opts.snapshotPronto ?? {
      tipo: opts.targetType, id: opts.targetId, donoId: alvo.ownerId,
      resumo: alvo.resumo ? alvo.resumo.slice(0, 2000) : null,
      ficheiros: alvo.media.map((m) => ({ tipo: m.tipo, chave: m.url })),
      mais18: alvo.mais18 ?? null,
      criadoEmConteudo: alvo.criadoEm ? alvo.criadoEm.toISOString() : null,
      capturadoEm: new Date().toISOString(),
      // Enquete: pergunta (no resumo), audiência, fim, opções e totais no momento. Só nas enquetes (o hash dos outros não muda).
      enquete: alvo.enquete,
    };
    const [rep] = await tx.insert(reportsTable).values({
      ...(opts.reportId !== undefined ? { id: opts.reportId } : {}),
      reporterId: opts.reporterId,
      targetType: opts.targetType,
      targetId: opts.targetId,
      targetOwnerId: alvo.ownerId,
      reason: opts.reason,
      description: opts.description || null,
      urgente,
      reporterContact: opts.contacto ?? null,
      reporterIp: opts.ip ?? null,
      alvoSnapshot: snapshot,
      // Cadeia de custódia: SHA-256 (JSON canónico) da cópia do alvo no momento da denúncia/retirada.
      alvoSnapshotSha256: sha256Hex(jsonCanonico(snapshot)),
    }).returning({ id: reportsTable.id });

    // Urgente: avisa TODOS os admins na mesma transação (se falhar, a denúncia não fica por avisar).
    if (urgente) {
      await notificarAdmins(tx, textoAlerta({ reportId: rep.id, alvo: TARGET_LABEL[opts.targetType], motivo: opts.reason, nivel: "nova", idadeMin: 0, perfil }), rep.id);
    }

    // Menor: retirada automática imediata (esconde, não apaga). Com sessão: sempre. Sem sessão: até 3 retiradas automáticas por
    // 24 h por IP e por contacto. Nunca para perfis. O ator fica em details.ator (a coluna admin_id é NOT NULL e exige um utilizador).
    let retiradoAuto = false;
    let ator: { tipo: "utilizador" | "publico"; id?: number } | null = null;
    if (urgente && opts.targetType !== "user") {
      if (opts.autoRetirar && opts.reporterId !== null) {
        ator = { tipo: "utilizador", id: opts.reporterId };
      } else if (opts.autoRetirarPublico && opts.reporterId === null && (await dentroDoLimitePublico(tx, opts.ip ?? null, opts.contacto ?? null))) {
        ator = { tipo: "publico" };
      }
    }
    if (ator) {
      const r = await retirarAlvo(tx, opts.targetType, opts.targetId, null, "Retirado automaticamente por denúncia de menor (a aguardar análise).");
      retiradoAuto = r.mudou;
      if (r.mudou) {
        if (ator.tipo === "publico") await tx.update(reportsTable).set({ retiradaAuto: true }).where(eq(reportsTable.id, rep.id));
        await notificarSistema(tx, alvo.ownerId, `O teu ${TARGET_LABEL[opts.targetType]} foi retirado temporariamente e está em análise pela equipa.`);
        await tx.insert(auditLogTable).values({
          // admin_id é NOT NULL: o denunciante (com sessão) ou, na rota pública, o dono do alvo. Quem agiu está em details.ator.
          adminId: opts.reporterId ?? alvo.ownerId, action: "conteudo_retirado_auto", targetType: opts.targetType, targetId: opts.targetId,
          details: { reportId: rep.id, motivo: "menor", ator },
        });
      }
    }
    return { id: rep.id, retiradoAuto };
  });
  // Canal externo só depois do commit; nunca lança nem atrasa a resposta.
  if (urgente) {
    void enviarEMarcarAlerta({ reportId: resultado.id, alvo: TARGET_LABEL[opts.targetType], motivo: opts.reason, nivel: "nova", idadeMin: 0, perfil });
  }
  return resultado;
}

export function tratarErro(err: unknown, res: import("express").Response, log: { error: (...a: any[]) => void } | undefined): void {
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
      contacto: contactoEmail.trim().toLowerCase(), ip: (req.ip ?? "").slice(0, 45) || null, autoRetirar: false, autoRetirarPublico: true,
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
