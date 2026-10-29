/**
 * Para logs: só o nome e o código do erro. NUNCA o erro bruto: o do Drizzle traz a query e os
 * parâmetros (email, hash da password, data de nascimento, IP, user-agent e texto de conteúdo).
 */
export function erroSeguro(err: unknown): { nome: string; codigo?: string } {
  const e = err as { name?: unknown; code?: unknown; cause?: { code?: unknown } };
  const codigo = typeof e?.code === "string" ? e.code : typeof e?.cause?.code === "string" ? e.cause.code : undefined;
  return { nome: typeof e?.name === "string" ? e.name : "desconhecido", ...(codigo ? { codigo } : {}) };
}
