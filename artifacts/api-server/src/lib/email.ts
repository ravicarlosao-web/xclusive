/**
 * Envio de email. Os chamadores usam SÓ `enviarEmail(...)`: o transporte (SMTP hoje; um serviço transacional amanhã) escolhe-se por variável
 * e é trocável sem mexer neles.
 *
 *  - EMAIL_TRANSPORTE = smtp | desligado. POR DEFEITO (em falta, vazio ou qualquer outro valor) = desligado: nada é enviado.
 *  - SMTP: SMTP_HOST, SMTP_PORTA, SMTP_SEGURO (true = TLS direto, típico da 465; false = STARTTLS obrigatório, típico da 587; por
 *    omissão true só na 465), SMTP_UTILIZADOR, SMTP_PALAVRA_PASSE.
 *  - EMAIL_REMETENTE (ex.: Xclusive <nao-responder@xclusive.ao>), EMAIL_RESPONDER_PARA (opcional), APP_URL_PUBLICO (base FIXA dos links:
 *    nunca o cabeçalho Host).
 *
 * Segredos: NUNCA vão para logs, erros nem respostas. As falhas viram um CÓDIGO (MotivoFalha); a mensagem do erro original (que pode
 * trazer o servidor, o utilizador ou respostas do SMTP) é descartada.
 */
import nodemailer from "nodemailer";
import { logger } from "./logger";

export type MensagemEmail = { para: string; assunto: string; texto: string; html?: string };
export type MotivoFalha = "desligado" | "configuracao_incompleta" | "autenticacao" | "ligacao" | "rejeitado" | "mensagem_invalida" | "erro";
export type ResultadoEmail = { ok: true } | { ok: false; motivo: MotivoFalha };

type Ambiente = Record<string, string | undefined>;

export interface ConfigEmail {
  transporte: "smtp" | "desligado";
  /** EMAIL_TRANSPORTE tinha um valor que não é «smtp» nem «desligado» (tratado como desligado). */
  transporteDesconhecido: boolean;
  /** NOMES das variáveis em falta ou inválidas (só com transporte smtp). Nunca valores. */
  faltam: string[];
  host: string; porta: number; seguro: boolean; utilizador: string; palavraPasse: string;
  remetente: string; responderPara: string | null; appUrl: string | null;
}

const lido = (env: Ambiente, nome: string): string => (env[nome] ?? "").trim();
const SEM_QUEBRAS = /[\r\n]/;
const ENDERECO = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

/** Endereço dentro de «Nome <endereco>» ou só «endereco»; null se inválido. */
function enderecoDe(v: string): string | null {
  if (!v || SEM_QUEBRAS.test(v)) return null;
  const m = v.match(/<([^<>]+)>\s*$/);
  const a = (m ? m[1] : v).trim();
  return ENDERECO.test(a) ? a : null;
}

const loopback = (h: string) => h === "localhost" || h === "127.0.0.1" || h === "::1";

export function lerConfigEmail(env: Ambiente = process.env): ConfigEmail {
  const bruto = lido(env, "EMAIL_TRANSPORTE").toLowerCase();
  const transporte = bruto === "smtp" ? "smtp" : "desligado";
  const porta = Number(lido(env, "SMTP_PORTA"));
  const portaOk = Number.isInteger(porta) && porta >= 1 && porta <= 65535;
  const seguroTxt = lido(env, "SMTP_SEGURO").toLowerCase();
  const seguro = seguroTxt === "true" ? true : seguroTxt === "false" ? false : portaOk && porta === 465;
  const remetente = lido(env, "EMAIL_REMETENTE"), responder = lido(env, "EMAIL_RESPONDER_PARA"), appUrlTxt = lido(env, "APP_URL_PUBLICO");
  let appUrl: string | null = null;
  try { const u = new URL(appUrlTxt); if (u.protocol === "https:" || (u.protocol === "http:" && loopback(u.hostname))) appUrl = u.origin + u.pathname.replace(/\/+$/, ""); } catch { /* inválido */ }

  const faltam: string[] = [];
  if (transporte === "smtp") {
    if (!lido(env, "SMTP_HOST")) faltam.push("SMTP_HOST");
    if (!portaOk) faltam.push("SMTP_PORTA");
    if (!lido(env, "SMTP_UTILIZADOR")) faltam.push("SMTP_UTILIZADOR");
    if (!env.SMTP_PALAVRA_PASSE) faltam.push("SMTP_PALAVRA_PASSE");
    if (!enderecoDe(remetente)) faltam.push("EMAIL_REMETENTE");
    if (responder && !enderecoDe(responder)) faltam.push("EMAIL_RESPONDER_PARA");
    if (!appUrl) faltam.push("APP_URL_PUBLICO");
  }
  return {
    transporte, transporteDesconhecido: !!bruto && bruto !== "smtp" && bruto !== "desligado", faltam,
    host: lido(env, "SMTP_HOST"), porta: portaOk ? porta : 0, seguro, utilizador: lido(env, "SMTP_UTILIZADOR"), palavraPasse: env.SMTP_PALAVRA_PASSE ?? "",
    remetente, responderPara: responder || null, appUrl,
  };
}

/** Endereço completo de uma página da app, a partir da base FIXA APP_URL_PUBLICO (nunca do cabeçalho Host). null se não estiver configurada. */
export function urlPublico(caminho: string, env: Ambiente = process.env): string | null {
  const base = lerConfigEmail(env).appUrl;
  return base ? base + (caminho.startsWith("/") ? caminho : "/" + caminho) : null;
}

/** Aviso no arranque (nunca falha): só NOMES de variáveis. */
export function avisarConfigEmail(log: Pick<typeof logger, "warn" | "info"> = logger, env: Ambiente = process.env): void {
  const c = lerConfigEmail(env);
  if (c.transporteDesconhecido) log.warn("Email: EMAIL_TRANSPORTE tem um valor desconhecido (usa «smtp» ou «desligado»): o envio fica DESLIGADO.");
  if (c.transporte === "smtp" && c.faltam.length > 0) log.warn({ faltam: c.faltam }, "Email: EMAIL_TRANSPORTE=smtp mas a configuração está incompleta ou inválida: nada será enviado até ser corrigida.");
  else if (c.transporte === "desligado") log.info("Email: envio desligado (EMAIL_TRANSPORTE não é «smtp»).");
}

/** Classifica uma falha SEM guardar a mensagem original. */
export function motivoDaFalha(err: unknown): MotivoFalha {
  const e = err as { code?: string; responseCode?: number } | null;
  const code = typeof e?.code === "string" ? e.code : "";
  if (code === "EAUTH") return "autenticacao";
  if (["ECONNECTION", "ETIMEDOUT", "ESOCKET", "ECONNREFUSED", "ENOTFOUND", "EDNS", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "ETLS"].includes(code)) return "ligacao";
  if (code === "EENVELOPE" || (typeof e?.responseCode === "number" && e.responseCode >= 500)) return "rejeitado";
  return "erro";
}

// ── Transportes (a interface é o ponto de troca para um serviço transacional) ──
export interface TransporteEmail { enviar(m: MensagemEmail, c: ConfigEmail): Promise<ResultadoEmail>; }

const transporteDesligado: TransporteEmail = { enviar: async () => ({ ok: false, motivo: "desligado" }) };

const transporteSmtp: TransporteEmail = {
  async enviar(m, c) {
    const t = nodemailer.createTransport({
      host: c.host, port: c.porta, secure: c.seguro,
      requireTLS: !c.seguro && !loopback(c.host),   // STARTTLS obrigatório fora do próprio computador
      auth: { user: c.utilizador, pass: c.palavraPasse },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
      logger: false, debug: false,
    });
    try {
      await t.sendMail({ from: c.remetente, replyTo: c.responderPara ?? undefined, to: m.para, subject: m.assunto, text: m.texto, ...(m.html ? { html: m.html } : {}) });
      return { ok: true };
    } catch (err) {
      return { ok: false, motivo: motivoDaFalha(err) };
    } finally { t.close(); }
  },
};

/** Envia um email. NUNCA lança: devolve o resultado (com um código de motivo em caso de falha). */
export async function enviarEmail(m: MensagemEmail, env: Ambiente = process.env): Promise<ResultadoEmail> {
  try {
    const c = lerConfigEmail(env);
    if (c.transporte !== "smtp") return transporteDesligado.enviar(m, c);
    if (c.faltam.length > 0) return { ok: false, motivo: "configuracao_incompleta" };
    // Um só destinatário e sem quebras de linha nos cabeçalhos (anti-injeção de cabeçalhos).
    if (!enderecoDe(m.para) || m.para.includes("<") || SEM_QUEBRAS.test(m.assunto) || !m.assunto.trim() || !m.texto.trim()) return { ok: false, motivo: "mensagem_invalida" };
    const r = await transporteSmtp.enviar(m, c);
    if (!r.ok) logger.warn({ motivo: r.motivo }, "Email: o envio falhou");
    return r;
  } catch {
    logger.warn({ motivo: "erro" }, "Email: o envio falhou");
    return { ok: false, motivo: "erro" };
  }
}
