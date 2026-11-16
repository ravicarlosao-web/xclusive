/**
 * Avisos por email das mudanças no TOTP de um admin (A4a), no padrão do alerta de login (A6): texto simples, sem ligações nem segredos, enviado DEPOIS de responder
 * (nunca bloqueia nem falha a operação; nunca lança), com limite de envios por conta e por hora contado no audit_log, e auditoria de cada envio (admin_totp_aviso_enviado / _falhou).
 * Eventos: ativado, desativado, reposto (por um superadmin ou pelo script), recuperacao_usada.
 */
import { sql } from "drizzle-orm";
import { db, auditLogTable } from "@workspace/db";
import { enviarEmail } from "./email";
import { emailLegal } from "./contactos";
import { dataHoraLuanda, ipParaEmail } from "./alertaLoginAdmin";
import { logger } from "./logger";

export const AVISO_MAX_POR_HORA = 5;
export const ACAO_AVISO_ENVIADO = "admin_totp_aviso_enviado";
export const ACAO_AVISO_FALHOU = "admin_totp_aviso_falhou";

export type EventoTotp = "ativado" | "desativado" | "reposto" | "recuperacao_usada";

const TEXTOS: Record<EventoTotp, { assunto: string; corpo: string }> = {
  ativado: { assunto: "Verificação em dois passos ativada na administração da Xclusive", corpo: "A verificação em dois passos (aplicação de autenticação) foi ATIVADA na tua conta de administração." },
  desativado: { assunto: "Verificação em dois passos desativada na administração da Xclusive", corpo: "A verificação em dois passos foi DESATIVADA na tua conta de administração." },
  reposto: { assunto: "Verificação em dois passos reposta na administração da Xclusive", corpo: "A verificação em dois passos da tua conta de administração foi REPOSTA (removida) por um superadmin ou pelo responsável do servidor. Todas as tuas sessões foram terminadas." },
  recuperacao_usada: { assunto: "Usaste um código de recuperação na administração da Xclusive", corpo: "Foi usado um CÓDIGO DE RECUPERAÇÃO para entrar na tua conta de administração. Cada código só funciona uma vez." },
};

export function emailTotpAdmin(evento: EventoTotp, quando: Date, ip: string | undefined, dispositivo: string | null): { assunto: string; texto: string } {
  const t = TEXTOS[evento], legal = emailLegal();
  const origem = dispositivo ? `Endereço IP: ${ipParaEmail(ip)}\nNavegador: ${dispositivo}\n` : "";
  return { assunto: t.assunto, texto: `Olá,\n\n${t.corpo}\n\nData e hora: ${dataHoraLuanda(quando)}\n${origem}\nSe foste tu, não precisas de fazer nada. Se não reconheces esta alteração, avisa de imediato um superadmin e contacta ${legal}.\n\n—\nXclusive · ${legal}` };
}

export interface PedidoAvisoTotp { adminId: number; email: string; evento: EventoTotp; ip?: string; dispositivo?: string | null }

/** Envia (se não passou o limite) e regista. Nunca lança. */
export async function avisarTotp(p: PedidoAvisoTotp): Promise<"enviado" | "falhou" | "limitado" | "erro"> {
  try {
    const [{ n }] = (await db.execute(sql`select count(*)::int as n from audit_log where admin_id = ${p.adminId} and action in (${ACAO_AVISO_ENVIADO}, ${ACAO_AVISO_FALHOU}) and criado_em > now() - interval '1 hour'`)).rows as { n: number }[];
    if (n >= AVISO_MAX_POR_HORA) { logger.warn({ codigo: "aviso_totp_limitado" }, "aviso de TOTP de admin: limite horário atingido, email não enviado"); return "limitado"; }
    const m = emailTotpAdmin(p.evento, new Date(), p.ip, p.dispositivo ?? null);
    const r = await enviarEmail({ para: p.email, assunto: m.assunto, texto: m.texto });
    await db.insert(auditLogTable).values({ adminId: p.adminId, action: r.ok ? ACAO_AVISO_ENVIADO : ACAO_AVISO_FALHOU, targetType: "user", targetId: p.adminId, ipAddress: p.ip?.slice(0, 45) ?? null, details: r.ok ? { evento: p.evento } : { evento: p.evento, motivo: r.motivo } });
    return r.ok ? "enviado" : "falhou";
  } catch {
    logger.warn({ codigo: "aviso_totp_erro" }, "aviso de TOTP de admin: erro interno (a operação não é afetada)");
    return "erro";
  }
}
