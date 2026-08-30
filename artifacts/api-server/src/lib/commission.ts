import { db, platformSettingsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Tipo de transacção derivado do db — sem imports circulares
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Lê a commission_rate efectiva para um criador dentro de uma transacção existente.
 *
 * Lógica de resolução (prioridade decrescente):
 *   1. Se `criadorId` for fornecido e o criador tiver `comissao_personalizada`
 *      definida (não NULL), usa esse valor.
 *   2. Caso contrário, lê `commission_rate` de `platform_settings` (FOR SHARE),
 *      garantindo que o valor não muda durante o processamento do pagamento.
 *   3. Se nem o override nem a chave global existirem, usa o default de 20.
 *
 * @param tx        - Transacção Drizzle activa.
 * @param criadorId - ID do criador que vai receber o pagamento (opcional).
 *                    Se omitido, usa sempre a taxa global.
 *
 * Devolve a percentagem como número (ex: 20 para 20%).
 */
export async function getCommissionRate(tx: Tx, criadorId?: number): Promise<number> {
  // 1. Verificar override por criador (sem lock adicional — a linha do utilizador
  //    já foi bloqueada em FOR UPDATE no início da transacção pelo handler de
  //    pagamento, pelo que a leitura aqui é segura e consistente).
  if (criadorId !== undefined) {
    const [creator] = await tx
      .select({ comissaoPersonalizada: usersTable.comissaoPersonalizada })
      .from(usersTable)
      .where(eq(usersTable.id, criadorId))
      .limit(1);

    const override = creator?.comissaoPersonalizada;
    if (override !== null && override !== undefined) {
      const overrideNum = parseFloat(String(override));
      if (overrideNum >= 0 && overrideNum <= 100) return overrideNum;
    }
  }

  // 2. Fallback: taxa global (FOR SHARE — impede alteração durante a transação).
  const [row] = await tx
    .select({ value: platformSettingsTable.value })
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, "commission_rate"))
    .for("share")
    .limit(1);

  const rate = (row?.value as { value?: number } | null)?.value;
  const finalRate = typeof rate === "number" && rate >= 0 && rate <= 100 ? rate : 20;

  // [DIAGNOSTIC LOG]
  console.log("[DIAGNÓSTICO COMISSÃO] getCommissionRate lido:", {
    rawRowValue: row?.value,
    extractedRate: rate,
    typeofRate: typeof rate,
    finalRateAplicada: finalRate,
    criadorId: criadorId,
  });

  return finalRate;
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
