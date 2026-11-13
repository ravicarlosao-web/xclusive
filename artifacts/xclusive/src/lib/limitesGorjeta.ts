/**
 * Limites de gorjetas e de bilhetes de transmissão, para mostrar ANTES de confirmar o pagamento (só os valores, sem texto legal).
 * Espelho do servidor, que é a autoridade: mensagens em api-server/src/lib/gorjetaMensagem.ts, publicações em routes/gorjeta.ts,
 * transmissões em direto em routes/live.ts e bilhetes em lib/liveTicket.ts.
 */
export const LIMITES_GORJETA = {
  mensagem: { min: 50, max: 100_000, diarioKz: 300_000, janelaHoras: 24 },
  publicacao: { max: 10_000_000 },
  live: { max: 10_000_000 },
  bilhete: { max: 100_000 },
} as const;

/** Milhares separados por espaço (igual ao resto das mensagens de limites). */
export const kzLimite = (v: number): string => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export const textoLimitesMensagem = (): string => {
  const l = LIMITES_GORJETA.mensagem;
  return `Mínimo ${kzLimite(l.min)} Kz · Máximo ${kzLimite(l.max)} Kz por gorjeta · Limite de ${kzLimite(l.diarioKz)} Kz em ${l.janelaHoras} horas`;
};
export const textoLimitePublicacao = (): string => `Máximo ${kzLimite(LIMITES_GORJETA.publicacao.max)} Kz por gorjeta`;
export const textoLimiteLive = (): string => `Máximo ${kzLimite(LIMITES_GORJETA.live.max)} Kz por gorjeta`;
export const textoLimiteBilhete = (): string => `Máximo ${kzLimite(LIMITES_GORJETA.bilhete.max)} Kz por bilhete`;
