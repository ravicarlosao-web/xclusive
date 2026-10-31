import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { subscricaoComAcesso } from "./exclusiveAccess";

/**
 * Permissão de enviar mensagens (bloqueio + regra de quem pode escrever), numa só consulta à BD.
 *
 * S = remetente, R = destinatário. Ordem de avaliação:
 *  1. contas de administração (S ou R com role admin/superadmin) ignoram regra e bloqueio;
 *  2. bloqueio: R bloqueou S → "fui_bloqueado" (S nunca fica a saber; os endpoints respondem como a conta inativa);
 *     S bloqueou R → "bloqueaste";
 *  3. regra de R (só se R for criador; para os restantes conta como 'todos'):
 *       todos                  → permitido;
 *       seguidores_assinantes  → S segue R (estado aceite) OU S assina R com acesso;
 *       assinantes             → S assina R com acesso (subscricaoComAcesso: ativa, gratuita, ou cancelada dentro do prazo);
 *     e, sempre, se R já escreveu nesta conversa, S pode responder.
 * A regra avalia-se a cada envio e na criação de conversa nova; o histórico nunca é afetado.
 */
export const REGRAS_MENSAGEM = ["todos", "seguidores_assinantes", "assinantes"] as const;
export type RegraMensagem = typeof REGRAS_MENSAGEM[number];
const ROLES_ADMIN = ["admin", "superadmin"];

export type EstadoPermissao = "ok" | "fui_bloqueado" | "bloqueaste" | "regra";

export interface PermissaoMensagem {
  estado: EstadoPermissao;
  pode: boolean;
  /** Regra efetiva de R (sempre 'todos' se R não for criador). */
  regra: RegraMensagem;
  /** @username de R (para as mensagens de recusa). */
  destinatarioUsername: string | null;
  destinatarioId: number | null;
}

const SEM_OUTRO: PermissaoMensagem = { estado: "ok", pode: true, regra: "todos", destinatarioUsername: null, destinatarioId: null };

/**
 * Permissão de S escrever a R. R pode vir dado, ou deduzir-se do outro participante da conversa.
 * `conversationId` (opcional) só serve a resposta permitida e a dedução de R.
 */
export async function permissaoMensagem(remetenteId: number, opcoes: { destinatarioId?: number | null; conversationId?: number | null }): Promise<PermissaoMensagem> {
  const R = opcoes.destinatarioId ?? null;
  const C = opcoes.conversationId ?? null;
  const agora = new Date();
  const r = await db.execute(sql`
    WITH s AS (SELECT id, role FROM users WHERE id = ${remetenteId}),
    r AS (
      SELECT id, role, username, tipo_conta, quem_pode_escrever FROM users
      WHERE id = COALESCE(${R}::int, (SELECT utilizador_id FROM conversation_participants WHERE conversation_id = ${C}::int AND utilizador_id <> ${remetenteId} LIMIT 1))
    )
    SELECT s.role AS s_role, r.id AS r_id, r.role AS r_role, r.username AS r_username, r.tipo_conta AS r_tipo, r.quem_pode_escrever AS r_regra,
      EXISTS (SELECT 1 FROM user_blocks WHERE blocker_id = s.id AND blocked_id = r.id) AS eu_bloqueei,
      EXISTS (SELECT 1 FROM user_blocks WHERE blocker_id = r.id AND blocked_id = s.id) AS fui_bloqueado,
      EXISTS (SELECT 1 FROM follows WHERE seguidor_id = s.id AND seguido_id = r.id AND estado = 'aceite') AS segue,
      EXISTS (SELECT 1 FROM subscriptions WHERE subscritor_id = s.id AND criador_id = r.id AND ${subscricaoComAcesso(agora)}) AS assina,
      EXISTS (SELECT 1 FROM messages WHERE conversation_id = ${C}::int AND autor_id = r.id) AS r_ja_escreveu
    FROM s, r`);
  const row = r.rows[0] as Record<string, unknown> | undefined;
  if (!row) return SEM_OUTRO; // sem outro participante (conversa legada de uma só pessoa): nada a restringir

  const regra: RegraMensagem = row.r_tipo === "criador" && (REGRAS_MENSAGEM as readonly string[]).includes(String(row.r_regra)) ? (row.r_regra as RegraMensagem) : "todos";
  const base = { regra, destinatarioUsername: String(row.r_username), destinatarioId: Number(row.r_id) };
  if (ROLES_ADMIN.includes(String(row.s_role)) || ROLES_ADMIN.includes(String(row.r_role))) return { ...base, estado: "ok", pode: true };
  if (row.fui_bloqueado) return { ...base, estado: "fui_bloqueado", pode: false };
  if (row.eu_bloqueei) return { ...base, estado: "bloqueaste", pode: false };
  if (regra === "todos" || row.r_ja_escreveu) return { ...base, estado: "ok", pode: true };
  const permitido = regra === "assinantes" ? !!row.assina : !!(row.segue || row.assina);
  return permitido ? { ...base, estado: "ok", pode: true } : { ...base, estado: "regra", pode: false };
}

/** Texto (pt-PT) de recusa pela regra. */
export function textoRegra(p: Pick<PermissaoMensagem, "regra" | "destinatarioUsername">): string {
  const quem = p.destinatarioUsername ? `@${p.destinatarioUsername}` : "esta conta";
  return p.regra === "assinantes"
    ? `Só os assinantes de ${quem} podem enviar-lhe mensagens.`
    : `Só os seguidores e assinantes de ${quem} podem enviar-lhe mensagens.`;
}

export const TEXTO_BLOQUEASTE = "Bloqueaste este utilizador. Desbloqueia-o para lhe enviares mensagens.";
