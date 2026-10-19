import { eq } from "drizzle-orm";
import { db, platformSettingsTable } from "@workspace/db";

type Leitor = Pick<typeof db, "select">;

/** Chave em platform_settings ({ "value": boolean }). Ausente => registos abertos. */
export const REGISTOS_KEY = "registos_abertos";

export const MSG_REGISTOS_FECHADOS = "Os registos estão fechados de momento. Volta a tentar mais tarde.";
export const CODIGO_REGISTOS_FECHADOS = "registos_fechados";

/** Lançado dentro da transação do registo quando o admin fechou os registos entretanto. */
export class RegistosFechadosError extends Error {
  constructor() {
    super(MSG_REGISTOS_FECHADOS);
    this.name = "RegistosFechadosError";
  }
}

/** Interpreta o valor guardado: SÓ um `false` explícito fecha (ausente ou valor estranho = aberto). */
export function registosAbertosDe(valor: unknown): boolean {
  return (valor as { value?: unknown } | null | undefined)?.value !== false;
}

/** Leitura simples (sem locks): para a rota pública e para a recusa rápida no início do registo. */
export async function lerRegistosAbertos(exec: Leitor = db): Promise<boolean> {
  const [row] = await exec
    .select({ value: platformSettingsTable.value })
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, REGISTOS_KEY))
    .limit(1);
  return registosAbertosDe(row?.value);
}

/**
 * Releitura DENTRO da transação do registo, com FOR SHARE: se o admin estiver a fechar os registos
 * (FOR UPDATE na mesma linha), esta leitura espera pelo commit dele e vê o valor novo.
 */
export async function lerRegistosAbertosBloqueando(tx: Pick<typeof db, "select">): Promise<boolean> {
  const [row] = await tx
    .select({ value: platformSettingsTable.value })
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, REGISTOS_KEY))
    .for("share")
    .limit(1);
  return registosAbertosDe(row?.value);
}
