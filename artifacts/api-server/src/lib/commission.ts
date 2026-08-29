import { db, platformSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Tipo de transacção derivado do db — sem imports circulares
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Lê a commission_rate activa dentro de uma transacção existente (FOR SHARE),
 * garantindo que o valor não muda durante o processamento do pagamento.
 *
 * Devolve a percentagem como número (ex: 20 para 20%).
 * Default: 20 (se a chave não existir na tabela).
 */
export async function getCommissionRate(tx: Tx): Promise<number> {
  const [row] = await tx
    .select({ value: platformSettingsTable.value })
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, "commission_rate"))
    .for("share")
    .limit(1);

  const rate = (row?.value as { value?: number } | null)?.value;
  return typeof rate === "number" && rate >= 0 && rate <= 100 ? rate : 20;
}

/**
 * Dado o valor total pago pelo fã e a taxa de comissão,
 * devolve { valorCriador, comissao } com arredondamento a 2 casas decimais.
 *
 * Exemplo: valor=1000, commissionRate=20 → { valorCriador: 800, comissao: 200 }
 */
export function calcComissao(
  valor: number,
  commissionRate: number,
): { valorCriador: number; comissao: number } {
  // Arredondamento correcto: 1 casa decimal * 10 / 100 = 2 casas decimais
  const comissao = Math.round(valor * commissionRate) / 100;
  const valorCriador = valor - comissao;
  return { valorCriador, comissao };
}
