import { db, usersTable, followsTable, notificationsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { eContaAdmin } from "./contasPublicas";
import { bloqueadoEntre } from "./permissaoMensagem";
import { agendarBoasVindas } from "./boasVindas";

export type ResultadoSeguir =
  | { ok: true; criada: boolean }
  | { ok: false; motivo: "inexistente" | "inativa" | "admin" | "propria" | "bloqueio" };

/**
 * ÚNICO caminho de «seguir» (usado pelo pedido da app e pelo seguir automático da conta oficial): valida a conta seguida, cria a relação (sem duplicar:
 * dois pedidos em paralelo não dão erro), notifica o seguido (a não ser que `notificar` seja falso) e enfileira a mensagem de boas-vindas (fora do pedido, nunca falha).
 * Só quem cria a relação notifica e enfileira. Conta inexistente, inativa, admin, a própria ou com bloqueio em qualquer sentido: nada é gravado.
 */
export async function seguirUtilizador(seguidorId: number, alvo: { id: number } | { username: string }, opcoes: { notificar?: boolean } = {}): Promise<ResultadoSeguir> {
  const [target] = await db.select().from(usersTable).where("id" in alvo ? eq(usersTable.id, alvo.id) : eq(usersTable.username, alvo.username.toLowerCase()));
  if (!target) return { ok: false, motivo: "inexistente" };
  if (!target.ativo) return { ok: false, motivo: "inativa" };
  if (eContaAdmin(target)) return { ok: false, motivo: "admin" };
  if (target.id === seguidorId) return { ok: false, motivo: "propria" };
  if (await bloqueadoEntre(seguidorId, target.id)) return { ok: false, motivo: "bloqueio" };

  const [existing] = await db.select().from(followsTable).where(and(eq(followsTable.seguidorId, seguidorId), eq(followsTable.seguidoId, target.id)));
  if (existing) return { ok: true, criada: false };
  // onConflictDoNothing: dois pedidos em paralelo não dão 500 ao que perde; só quem criou a relação notifica.
  const criada = await db.insert(followsTable).values({ seguidorId, seguidoId: target.id }).onConflictDoNothing().returning({ id: followsTable.seguidorId });
  if (criada.length === 0) return { ok: true, criada: false };
  if (opcoes.notificar !== false) {
    await db.insert(notificationsTable).values({ destinatarioId: target.id, tipo: "novo_seguidor", atorId: seguidorId, alvoId: null }).onConflictDoNothing();
  }
  // Mensagem automática de boas-vindas (se a criadora tiver uma ativa e o interruptor geral estiver ligado): fora do pedido, nunca espera nem falha o seguir.
  agendarBoasVindas(target.id, seguidorId);
  return { ok: true, criada: true };
}
