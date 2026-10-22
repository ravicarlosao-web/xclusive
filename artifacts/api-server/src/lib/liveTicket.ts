import { z } from "zod/v4";

/** Limites do preço do bilhete de uma live paga (inteiro, em Kz). Fonte única. */
export const LIVE_TICKET_MIN_KZ = 500;
export const LIVE_TICKET_MAX_KZ = 100_000;

/**
 * Corpo opcional de POST /live/start.
 *   gratuita => preço 0 (ou omitido)
 *   paga     => preço obrigatório, inteiro, dentro dos limites
 */
export const liveStartSchema = z
  .object({
    tipo: z.enum(["gratuita", "paga"]).default("gratuita"),
    preco: z.number().int("O preço deve ser um número inteiro em Kz.").optional(),
    // Marcação +18, fixa desde a abertura (como tipo e preço). Obrigatória (boolean estrito) ao abrir uma live nova.
    mais18: z.boolean({ error: "O campo mais18 é obrigatório e tem de ser verdadeiro ou falso." }),
  })
  .superRefine((data, ctx) => {
    if (data.tipo === "gratuita") {
      if (data.preco !== undefined && data.preco !== 0) {
        ctx.addIssue({ code: "custom", path: ["preco"], message: "Uma live gratuita não tem preço." });
      }
      return;
    }
    if (
      data.preco === undefined ||
      data.preco < LIVE_TICKET_MIN_KZ ||
      data.preco > LIVE_TICKET_MAX_KZ
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["preco"],
        message: `O preço do bilhete deve estar entre ${LIVE_TICKET_MIN_KZ} e ${LIVE_TICKET_MAX_KZ} Kz.`,
      });
    }
  });
