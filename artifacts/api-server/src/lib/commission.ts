import { db, platformSettingsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Tipo de transacção derivado do db — sem imports circulares
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Qualquer ligação ou transação que consiga fazer SELECT (db ou tx). */
type Leitor = Pick<typeof db, "select">;

/** Chave em platform_settings onde o admin guarda a taxa global ({ "value": <0-100> }). */
export const COMMISSION_KEY = "commission_rate";

/**
 * A comissão não pode ser determinada (sem taxa global definida, valor inválido, ou override do criador
 * inválido). A comissão vem SEMPRE da base de dados — não existe valor por omissão. Lançada antes de
 * qualquer débito, dentro da transação do pagamento: nada é cobrado. As rotas respondem 503.
 */
export class CommissionNotConfiguredError extends Error {
  readonly httpStatus = 503;
  constructor(public readonly motivo: "global_em_falta" | "override_invalido") {
    super("A comissão da plataforma não está configurada. Tenta novamente mais tarde.");
    this.name = "CommissionNotConfiguredError";
  }
}

/** Uma taxa válida é um NÚMERO finito entre 0 e 100 (inclusive). */
export function taxaValida(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
}

/** No máximo 2 casas decimais (a coluna taxa_comissao e o override são numeric(5,2)). */
export function taxaComDuasCasas(v: number): boolean {
  return Math.round(v * 100) / 100 === v;
}

type Override = { tipo: "nenhum" } | { tipo: "valor"; taxa: number } | { tipo: "invalido" };

async function lerOverride(exec: Leitor, criadorId: number): Promise<Override> {
  const [creator] = await exec
    .select({ comissaoPersonalizada: usersTable.comissaoPersonalizada })
    .from(usersTable)
    .where(eq(usersTable.id, criadorId))
    .limit(1);
  const bruto = creator?.comissaoPersonalizada;
  if (bruto === null || bruto === undefined) return { tipo: "nenhum" };
  const n = Number(bruto);
  return taxaValida(n) ? { tipo: "valor", taxa: n } : { tipo: "invalido" };
}

/** Taxa global guardada em platform_settings, ou null se não existir / for inválida. Sem locks. */
export async function lerTaxaGlobal(exec: Leitor): Promise<number | null> {
  const [row] = await exec
    .select({ value: platformSettingsTable.value })
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, COMMISSION_KEY))
    .limit(1);
  const rate = (row?.value as { value?: unknown } | null)?.value;
  return taxaValida(rate) ? rate : null;
}

/**
 * Taxa efetiva de um criador SEM lançar erro (para o admin e para as estatísticas do criador):
 * a taxa e de onde vem. `taxa` é null quando não há taxa utilizável ("nao_definida" ou "invalida").
 */
export async function lerTaxaEfetiva(
  exec: Leitor,
  criadorId: number,
): Promise<{ taxa: number | null; fonte: "personalizada" | "global" | "nao_definida" | "invalida" }> {
  const o = await lerOverride(exec, criadorId);
  if (o.tipo === "valor") return { taxa: o.taxa, fonte: "personalizada" };
  if (o.tipo === "invalido") return { taxa: null, fonte: "invalida" };
  const global = await lerTaxaGlobal(exec);
  return global === null ? { taxa: null, fonte: "nao_definida" } : { taxa: global, fonte: "global" };
}

/**
 * Lê a taxa de comissão efetiva para um criador dentro de uma transacção existente.
 *
 * Ordem de resolução:
 *   1. Se `criadorId` for fornecido e o criador tiver `comissao_personalizada` (não NULL), usa-a.
 *      Se esse override for inválido, lança CommissionNotConfiguredError — NUNCA cai para a global.
 *   2. Caso contrário, lê `commission_rate` de `platform_settings` (FOR SHARE, para o valor não
 *      mudar durante o pagamento).
 *   3. Sem taxa global definida (ou inválida) lança CommissionNotConfiguredError (HTTP 503).
 *      Não existe taxa por omissão.
 *
 * Devolve a percentagem como número (ex.: 12.5 para 12,5 %).
 */
export async function getCommissionRate(tx: Tx, criadorId?: number): Promise<number> {
  if (criadorId !== undefined) {
    const o = await lerOverride(tx, criadorId);
    if (o.tipo === "valor") return o.taxa;
    if (o.tipo === "invalido") throw new CommissionNotConfiguredError("override_invalido");
  }

  const [row] = await tx
    .select({ value: platformSettingsTable.value })
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, COMMISSION_KEY))
    .for("share")
    .limit(1);

  const rate = (row?.value as { value?: unknown } | null)?.value;
  if (!taxaValida(rate)) throw new CommissionNotConfiguredError("global_em_falta");
  return rate;
}

/**
 * Dado o valor total pago pelo fã e a taxa de comissão,
 * devolve { valorCriador, comissao } com arredondamento a 2 casas decimais.
 *
 * Exemplo (taxa lida da base de dados): valor=1000, taxa=12,5 → { valorCriador: 875, comissao: 125 }
 */
export function calcComissao(
  valor: number,
  commissionRate: number,
): { valorCriador: number; comissao: number } {
  if (!taxaValida(commissionRate)) throw new CommissionNotConfiguredError("global_em_falta");
  // Arredondamento correcto: 1 casa decimal * 10 / 100 = 2 casas decimais
  const comissao = Math.round(valor * commissionRate) / 100;
  const valorCriador = valor - comissao;
  return { valorCriador, comissao };
}
