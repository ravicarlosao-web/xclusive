import { db, platformSettingsTable, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";
import { eContaAdmin } from "./contasPublicas";
import { seguirUtilizador } from "./seguir";

/**
 * Seguir automático da conta oficial da plataforma, SÓ no registo de contas novas (palavra-passe e Google).
 * Chaves em platform_settings: `seguir_oficial_ativo` ({"value": boolean}; ausente = DESLIGADO) e `conta_oficial_username` ({"value": string}; ausente = «xclusive»).
 * Passa pelo MESMO caminho de «seguir» da app (lib/seguir.ts), sem a notificação de «novo seguidor» para a conta oficial; isso dispara o enfileiramento da boas-vindas.
 * Nunca falha quem chama: erros ficam no log só com um código (sem dados pessoais).
 */
export const SEGUIR_OFICIAL = {
  CHAVE_ATIVO: "seguir_oficial_ativo",
  CHAVE_USERNAME: "conta_oficial_username",
  CHAVE_SCRIPT_ATE_ID: "seguir_oficial_script_ate_id",
  USERNAME_POR_DEFEITO: "xclusive",
} as const;

export async function lerSeguirOficial(): Promise<{ ativo: boolean; username: string }> {
  const rows = await db.select({ key: platformSettingsTable.key, value: platformSettingsTable.value }).from(platformSettingsTable)
    .where(sql`${platformSettingsTable.key} IN (${SEGUIR_OFICIAL.CHAVE_ATIVO}, ${SEGUIR_OFICIAL.CHAVE_USERNAME})`);
  const v = (k: string) => (rows.find((r) => r.key === k)?.value as { value?: unknown } | null | undefined)?.value;
  const nome = v(SEGUIR_OFICIAL.CHAVE_USERNAME);
  return { ativo: v(SEGUIR_OFICIAL.CHAVE_ATIVO) === true, username: typeof nome === "string" && nome.trim() !== "" ? nome.trim().toLowerCase() : SEGUIR_OFICIAL.USERNAME_POR_DEFEITO };
}

export type MotivoSeguirOficial = "desligado" | "conta_oficial_invalida" | "conta_inativa" | "conta_admin" | "e_a_oficial" | "ja_segue" | "bloqueio" | "ok";

/** A conta oficial configurada (existe, ativa, não é de administração)? Devolve-a ou o motivo. */
export async function contaOficial(username: string): Promise<{ id: number; username: string } | { erro: "inexistente" | "inativa" | "admin" }> {
  const [o] = await db.select({ id: usersTable.id, username: usersTable.username, ativo: usersTable.ativo, role: usersTable.role }).from(usersTable).where(eq(usersTable.username, username.toLowerCase())).limit(1);
  if (!o) return { erro: "inexistente" };
  if (!o.ativo) return { erro: "inativa" };
  if (eContaAdmin(o)) return { erro: "admin" };
  return { id: o.id, username: o.username };
}

/** Segue a oficial em nome de `userId` (sem ler o interruptor): usado pelo registo (depois de ler o interruptor) e pelo script de uso único. */
export async function seguirOficialConta(userId: number, oficial: { id: number }): Promise<MotivoSeguirOficial> {
  if (userId === oficial.id) return "e_a_oficial";
  const r = await seguirUtilizador(userId, { id: oficial.id }, { notificar: false });
  if (r.ok) return r.criada ? "ok" : "ja_segue";
  return r.motivo === "bloqueio" ? "bloqueio" : r.motivo === "admin" ? "conta_admin" : r.motivo === "inativa" ? "conta_inativa" : "conta_oficial_invalida";
}

/**
 * Chamado pelo registo DEPOIS de a conta estar criada. Fire-and-forget: devolve já; nunca lança. Desligado, conta oficial inexistente/inativa,
 * a nova conta ser admin ou a própria oficial: não faz nada. Falha: log com o código, sem dados pessoais.
 */
export function agendarSeguirOficial(novoUserId: number): void {
  void (async () => {
    try {
      const cfg = await lerSeguirOficial();
      if (!cfg.ativo) return;
      const [novo] = await db.select({ ativo: usersTable.ativo, role: usersTable.role }).from(usersTable).where(eq(usersTable.id, novoUserId)).limit(1);
      if (!novo || !novo.ativo || eContaAdmin(novo)) return;
      const o = await contaOficial(cfg.username);
      if ("erro" in o) { logger.warn({ codigo: "seguir_oficial_conta_invalida", motivo: o.erro }, "Seguir oficial: conta oficial indisponível; o registo seguiu sem seguir"); return; }
      const r = await seguirOficialConta(novoUserId, o);
      if (r !== "ok" && r !== "ja_segue") logger.info({ codigo: "seguir_oficial_nao_seguiu", motivo: r }, "Seguir oficial: não seguiu");
    } catch (err) {
      logger.warn({ codigo: "seguir_oficial_falhou", erro: (err as { code?: string } | null)?.code ?? (err as Error | null)?.name ?? "erro" }, "Seguir oficial: falhou (o registo não é afetado)");
    }
  })();
}
