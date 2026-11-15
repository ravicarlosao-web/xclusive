import { inArray } from "drizzle-orm";
import { db, platformSettingsTable } from "@workspace/db";

/**
 * Configuração do carregamento manual, guardada na BD (platform_settings; value = {"value": …}), NUNCA no código:
 *   topup_banco_nib      os 21 dígitos do NIB da conta que recebe as transferências (aceita-se com pontos, espaços ou hífens; guarda-se e usa-se só com dígitos)
 *   topup_banco_titular  o titular da conta
 *   topup_metodos_automaticos_ativos  true liga os métodos AppyPay (Multicaixa Express e Referência); por defeito (ausente/false) ficam «Brevemente» e o servidor recusa-os
 * Sem NIB válido ou sem titular, o carregamento manual não está disponível (o servidor recusa e o ecrã diz-o).
 */
export const TOPUP_NIB_KEY = "topup_banco_nib";
export const TOPUP_TITULAR_KEY = "topup_banco_titular";
export const TOPUP_AUTOMATICOS_KEY = "topup_metodos_automaticos_ativos";

/** Só dígitos (sem pontos, espaços nem hífens) e exatamente 21; senão null. */
export function nibValido(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const d = raw.replace(/[\s.\-]/g, "");
  return /^\d{21}$/.test(d) ? d : null;
}
/** 0000 1111 2222 3333 4444 5 (blocos de 4 e o último dígito; exemplo inventado). */
export const formatarNib = (nib: string): string => `${nib.slice(0, 20).replace(/(.{4})/g, "$1 ").trim()} ${nib.slice(20)}`;

export interface ConfigTopup { nib: string | null; titular: string | null; automaticos: boolean }

export async function lerConfigTopup(q: Pick<typeof db, "select"> = db): Promise<ConfigTopup> {
  const rows = await q.select({ key: platformSettingsTable.key, value: platformSettingsTable.value }).from(platformSettingsTable)
    .where(inArray(platformSettingsTable.key, [TOPUP_NIB_KEY, TOPUP_TITULAR_KEY, TOPUP_AUTOMATICOS_KEY]));
  const v = (k: string): unknown => (rows.find((r) => r.key === k)?.value as { value?: unknown } | null)?.value;
  const titular = typeof v(TOPUP_TITULAR_KEY) === "string" ? (v(TOPUP_TITULAR_KEY) as string).trim() : "";
  return { nib: nibValido(v(TOPUP_NIB_KEY)), titular: titular && titular.length <= 120 ? titular : null, automaticos: v(TOPUP_AUTOMATICOS_KEY) === true };
}

export const MSG_METODO_INDISPONIVEL = "Este método de pagamento ainda não está disponível («Brevemente»). Usa a transferência bancária manual.";
