/**
 * Alerta por email de novo login de admin/superadmin (A6).
 *
 *  - Um email por login COM SUCESSO (inclui o login que obriga a trocar a palavra-passe). Nenhum em login falhado nem em conta bloqueada
 *    (o chamador só o invoca depois do `admin_login_ok`). Vai para o email da própria conta de admin.
 *  - NUNCA bloqueia nem falha o login: o chamador dispara-o DEPOIS de responder (`void alertarLoginAdmin(...)`) e esta função nunca lança.
 *  - O email é só texto e leva: data/hora (Africa/Luanda), IP, navegador e sistema resumidos (vocabulário fechado: o User-Agent em bruto
 *    nunca vai no email) e a marca de IP/dispositivo novo. Nunca leva o caminho secreto do painel, ligações, tokens, ids de sessão nem palavra-passe.
 *  - «Novo» = ainda não há, no audit_log, outro `admin_login_ok` desta conta com o mesmo IP (ou com o mesmo dispositivo) nos últimos 90 dias.
 *    O dispositivo é guardado resumido em `details.dispositivo` do `admin_login_ok` (sem migrações). Logins anteriores a esta PR não têm o
 *    campo: o primeiro login depois do deploy conta como «dispositivo novo» uma única vez.
 *  - Limite: no máximo ALERTA_MAX_POR_HORA emails por conta por hora, contados no audit_log (sobrevive a reinícios e a várias instâncias).
 *  - Auditoria: `admin_login_alerta_enviado` ou `admin_login_alerta_falhou` (com o código do motivo, nunca o endereço nem o texto).
 */
import { sql } from "drizzle-orm";
import { db, auditLogTable } from "@workspace/db";
import { enviarEmail } from "./email";
import { emailLegal } from "./contactos";
import { logger } from "./logger";

export const ALERTA_MAX_POR_HORA = 5;
export const ALERTA_JANELA_NOVO_DIAS = 90;
export const ACAO_ENVIADO = "admin_login_alerta_enviado";
export const ACAO_FALHOU = "admin_login_alerta_falhou";

/** Navegador e sistema, de um vocabulário fechado (nunca o texto do User-Agent). */
export function resumirDispositivo(ua: string | undefined): string {
  try {
    const s = String(ua ?? "").slice(0, 500);
    const navegador = /Edg(e|A|iOS)?\//.test(s) ? "Edge" : /OPR\/|Opera/.test(s) ? "Opera" : /Firefox\/|FxiOS\//.test(s) ? "Firefox"
      : /Chrome\/|CriOS\//.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : "navegador desconhecido";
    const sistema = /Windows/.test(s) ? "Windows" : /Android/.test(s) ? "Android" : /iPhone|iPad|iPod/.test(s) ? "iOS"
      : /Mac OS X|Macintosh/.test(s) ? "macOS" : /Linux|X11/.test(s) ? "Linux" : "sistema desconhecido";
    return `${navegador} em ${sistema}`;
  } catch { return "navegador desconhecido em sistema desconhecido"; }
}

/** IP para o email: só caracteres de um endereço IP (sem prefixo IPv4-mapeado); qualquer outra coisa vira «desconhecido». */
export function ipParaEmail(ip: string | undefined): string {
  const v = String(ip ?? "").replace(/^::ffff:/i, "");
  return /^[0-9a-fA-F:.]{2,45}$/.test(v) ? v : "desconhecido";
}

/** «15/11/2026, 21:05 (hora de Luanda)». */
export function dataHoraLuanda(d: Date): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("pt-PT", { timeZone: "Africa/Luanda", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year}, ${p.hour}:${p.minute} (hora de Luanda)`;
}

export function emailLoginAdmin(a: { quando: Date; ip: string; dispositivo: string; novoIp: boolean; novoDispositivo: boolean }): { assunto: string; texto: string } {
  const marca = a.novoIp && a.novoDispositivo ? "IP novo e dispositivo novo: nunca usados nas sessões anteriores desta conta."
    : a.novoIp ? "IP novo: nunca usado nas sessões anteriores desta conta."
    : a.novoDispositivo ? "Dispositivo novo: nunca usado nas sessões anteriores desta conta."
    : "IP e dispositivo já usados nas sessões anteriores desta conta.";
  const legal = emailLegal();
  return {
    assunto: (a.novoIp || a.novoDispositivo) ? "Novo início de sessão na administração da Xclusive (IP ou dispositivo novo)" : "Novo início de sessão na administração da Xclusive",
    texto: `Olá,\n\nFoi iniciada uma sessão na administração da Xclusive com a tua conta.\n\nData e hora: ${dataHoraLuanda(a.quando)}\nEndereço IP: ${a.ip}\nNavegador: ${a.dispositivo}\n${marca}\n\n`
      + `Se foste tu, não precisas de fazer nada. Se não reconheces este acesso, avisa de imediato um superadmin e contacta ${legal}.\n\n—\nXclusive · ${legal}`,
  };
}

export interface PedidoAlerta { adminId: number; email: string; ip: string | undefined; dispositivo: string; auditId: number; quando?: Date }

/** Envia (ou não, se passou o limite) o alerta e regista o resultado. Nunca lança. */
export async function alertarLoginAdmin(p: PedidoAlerta): Promise<"enviado" | "falhou" | "limitado" | "erro"> {
  try {
    const ip = ipParaEmail(p.ip);
    const [{ n }] = (await db.execute(sql`select count(*)::int as n from audit_log where admin_id = ${p.adminId} and action in (${ACAO_ENVIADO}, ${ACAO_FALHOU})
      and criado_em > now() - interval '1 hour'`)).rows as { n: number }[];
    if (n >= ALERTA_MAX_POR_HORA) { logger.warn({ codigo: "alerta_login_admin_limitado" }, "alerta de login de admin: limite horário atingido, email não enviado"); return "limitado"; }

    const [antes] = (await db.execute(sql`select
        bool_or(ip_address is not distinct from ${p.ip ?? null}) as mesmo_ip,
        bool_or(details->>'dispositivo' = ${p.dispositivo}) as mesmo_dispositivo
      from audit_log where admin_id = ${p.adminId} and action = 'admin_login_ok' and id <> ${p.auditId}
        and criado_em > now() - make_interval(days => ${ALERTA_JANELA_NOVO_DIAS})`)).rows as { mesmo_ip: boolean | null; mesmo_dispositivo: boolean | null }[];
    const novoIp = antes?.mesmo_ip !== true, novoDispositivo = antes?.mesmo_dispositivo !== true;

    const m = emailLoginAdmin({ quando: p.quando ?? new Date(), ip, dispositivo: p.dispositivo, novoIp, novoDispositivo });
    const r = await enviarEmail({ para: p.email, assunto: m.assunto, texto: m.texto });
    await db.insert(auditLogTable).values({
      adminId: p.adminId, action: r.ok ? ACAO_ENVIADO : ACAO_FALHOU, targetType: "user", targetId: p.adminId, ipAddress: p.ip?.slice(0, 45) ?? null,
      details: r.ok ? { novoIp, novoDispositivo } : { motivo: r.motivo, novoIp, novoDispositivo },
    });
    return r.ok ? "enviado" : "falhou";
  } catch {
    logger.warn({ codigo: "alerta_login_admin_erro" }, "alerta de login de admin: erro interno (login não afetado)");
    return "erro";
  }
}
