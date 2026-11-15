/**
 * Regras do carregamento MANUAL (pedido do utilizador + aprovação do admin). Constantes e validação do comprovativo num só sítio.
 * Sem sistema de reembolso (decisão fechada): o saldo só se gasta.
 */
export const VALOR_MIN = 500;
export const VALOR_MAX = 1_000_000;
/** Pedidos pendentes por conta (o 4.º dá 409). */
export const MAX_PENDENTES = 3;
/** Um pedido igual (mesma conta e valor) criado há menos de isto é recusado (duplo clique, repetição). */
export const JANELA_REPETIDO_MS = 10 * 60 * 1000;
/** Acima deste valor só um superadmin aprova. */
export const LIMITE_APROVACAO_ADMIN = 100_000;
/** Pedidos pendentes há mais de isto (dias) são destacados no painel. */
export const IDADE_AVISO_DIAS = 7;
/** Tamanho máximo do comprovativo («data:application/pdf;base64,…»), em caracteres (≈5 MB de PDF). */
export const COMPROVATIVO_MAX_CHARS = 7_000_000;
/** Limite do corpo desta rota (maior que o comprovativo máximo + o resto do JSON). */
export const CORPO_MAX = "8mb";

const PREFIXO = "data:application/pdf;base64,";
const RE_COMPROVATIVO = /^data:application\/pdf;base64,[A-Za-z0-9+/]+={0,2}$/;
/** Letras (qualquer língua) e dígitos, espaço, ponto, parênteses, hífen e sublinhado: nada que seja HTML nem caminho. */
const RE_NOME = /^[\p{L}\p{N}_ .()-]{1,100}$/u;

export type ResultadoComprovativo = { ok: true; base64: string; nome: string } | { ok: false; erro: string };

/** Valida o comprovativo e o nome do ficheiro. Sem comprovativo (e sem nome) devolve ok com base64 vazio. */
export function validarComprovativo(base64: string | undefined, nome: string | undefined): ResultadoComprovativo | { ok: true; base64: null; nome: null } {
  if (base64 === undefined) {
    if (nome !== undefined) return { ok: false, erro: "Nome de ficheiro sem comprovativo." };
    return { ok: true, base64: null, nome: null };
  }
  if (base64.length > COMPROVATIVO_MAX_CHARS) return { ok: false, erro: "O comprovativo é demasiado grande (máximo 5 MB)." };
  if (!RE_COMPROVATIVO.test(base64) || (base64.length - PREFIXO.length) % 4 !== 0) return { ok: false, erro: "O comprovativo tem de ser um ficheiro PDF." };
  // Assinatura: os primeiros bytes descodificados têm de ser «%PDF-» (só se descodificam os primeiros 8 caracteres).
  const inicio = Buffer.from(base64.slice(PREFIXO.length, PREFIXO.length + 8), "base64").toString("latin1");
  if (!inicio.startsWith("%PDF-")) return { ok: false, erro: "O comprovativo tem de ser um ficheiro PDF." };
  const n = nome ?? "comprovativo.pdf";
  if (!RE_NOME.test(n) || !/\.pdf$/i.test(n)) return { ok: false, erro: "Nome de ficheiro inválido (só letras, números, espaços, ponto, hífen e parênteses; termina em .pdf)." };
  return { ok: true, base64, nome: n };
}
