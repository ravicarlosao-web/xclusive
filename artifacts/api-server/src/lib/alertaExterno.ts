import { eq, and, isNull } from "drizzle-orm";
import { db, reportsTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * Gancho para um canal externo (webhook) de alertas de denúncias urgentes.
 *
 * - REPORTS_ALERT_WEBHOOK_URL ausente → não faz nada.
 * - Discord (discord.com/discordapp.com/api/webhooks/…): POST JSON {"content": "<texto curto>"}.
 * - Qualquer outro URL (ntfy): POST com texto simples no corpo e cabeçalho Title (só ASCII).
 * - O texto leva SÓ id, tipo de alvo, motivo e idade. Nunca conteúdo, denunciante, IP, e-mail nem links.
 * - O URL nunca vai para logs (nem em erros). Timeout curto; nunca lança: uma falha aqui não pode
 *   afetar a denúncia nem o job. Chamar SEMPRE depois do commit da transação.
 * - Entrega bem-sucedida → marca reports.alerta_externo_em; o job (lib/reportEscalation.ts) reenvia as
 *   urgentes pendentes que não o têm.
 */
export type AlertaNivel = "nova" | "1h" | "24h";

export interface AlertaUrgente {
  reportId: number;
  /** Rótulo do tipo de alvo (ex.: "publicação", "reel"). */
  alvo: string;
  motivo: string;
  nivel: AlertaNivel;
  idadeMin: number;
  /** Denúncia urgente a um PERFIL: nunca se suspende sozinho, por isso o alerta sai reforçado. */
  perfil?: boolean;
}

const TIMEOUT_MS = 5_000;

export function idadeLegivel(min: number): string {
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  return h < 48 ? `há ${h} h` : `há ${Math.floor(h / 24)} d`;
}

/** Texto curto partilhado pelo canal externo e pelas notificações internas. */
export function textoAlerta(a: AlertaUrgente): string {
  const prefixo = a.nivel === "nova"
    ? "Nova denúncia URGENTE"
    : a.nivel === "1h" ? "Denúncia URGENTE por tratar" : "ESCALADA: denúncia URGENTE por tratar";
  const reforco = a.perfil ? " — PERFIL SEM SUSPENSÃO AUTOMÁTICA: avaliar já" : "";
  return `${prefixo} #${a.reportId} — ${a.alvo} — motivo: ${a.motivo} — ${idadeLegivel(a.idadeMin)}${reforco}`;
}

function eDiscord(url: URL): boolean {
  return /(^|\.)discord(app)?\.com$/i.test(url.hostname) && url.pathname.startsWith("/api/webhooks/");
}

export function alertaExternoAtivo(): boolean {
  return Boolean(process.env.REPORTS_ALERT_WEBHOOK_URL?.trim());
}

/** Envia o alerta. Devolve true só se o webhook respondeu 2xx. */
export async function enviarAlertaExterno(a: AlertaUrgente): Promise<boolean> {
  const raw = process.env.REPORTS_ALERT_WEBHOOK_URL?.trim();
  if (!raw) return false;
  try {
    const url = new URL(raw);
    const texto = textoAlerta(a);
    const init: RequestInit = eDiscord(url)
      ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: texto }) }
      : { method: "POST", headers: { "Content-Type": "text/plain; charset=utf-8", Title: "Denuncia urgente - Xclusive" }, body: texto };
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      logger.warn({ status: res.status, reportId: a.reportId }, "Alerta externo de denúncia recusado");
      return false;
    }
    return true;
  } catch (err) {
    // Só o nome do erro: a mensagem/causa pode conter o URL.
    logger.warn({ erro: err instanceof Error ? err.name : "desconhecido", reportId: a.reportId }, "Falha no alerta externo de denúncia");
    return false;
  }
}

type Exec = Pick<typeof db, "update">;

/**
 * Envia e, se entregue, marca a denúncia (só se ainda não estava marcada). Nunca lança.
 * `exec`: a transação do job (a linha já está bloqueada por ela) ou, por omissão, a ligação normal.
 */
export async function enviarEMarcarAlerta(a: AlertaUrgente, exec: Exec = db): Promise<boolean> {
  const ok = await enviarAlertaExterno(a);
  if (!ok) return false;
  try {
    await exec.update(reportsTable).set({ alertaExternoEm: new Date() })
      .where(and(eq(reportsTable.id, a.reportId), isNull(reportsTable.alertaExternoEm)));
  } catch (err) {
    logger.warn({ erro: err instanceof Error ? err.name : "desconhecido", reportId: a.reportId }, "Falha ao marcar alerta externo");
  }
  return true;
}
