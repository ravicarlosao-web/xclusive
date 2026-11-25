/**
 * Mensagem de boas-vindas (Painel do Criador): regras de validação do formulário, iguais às do servidor
 * (texto ≤ 1000 caracteres; imagem JPG/PNG/WebP até 5 MB). Funções puras, sem rede.
 */
export const BV_TEXTO_MAX = 1000;
export const BV_IMAGEM_MAX_BYTES = 5 * 1024 * 1024;
export const BV_TIPOS_IMAGEM = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const BV_ACCEPT_IMAGEM = BV_TIPOS_IMAGEM.join(',');

/** Caracteres como o servidor conta (pontos de código: um emoji conta como 1). */
export function contarCaracteres(texto: string): number {
  return Array.from(texto).length;
}

/** Mensagem em pt-PT se o ficheiro não serve, ou null. */
export function validarImagemBoasVindas(file: { type: string; size: number }): string | null {
  if (!(BV_TIPOS_IMAGEM as readonly string[]).includes(file.type)) return 'Só são aceites imagens JPG, PNG ou WebP.';
  if (file.size === 0) return 'O ficheiro está vazio.';
  if (file.size > BV_IMAGEM_MAX_BYTES) return 'A imagem excede o limite de 5 MB.';
  return null;
}

export interface RascunhoBoasVindas { texto: string; midiaUrl: string | null; ativa: boolean }

/** O que impede de guardar (mensagem em pt-PT) ou null se pode. «Nada de guardar sem texto nem imagem.» */
export function erroDoRascunho(r: RascunhoBoasVindas): string | null {
  const n = contarCaracteres(r.texto);
  if (n > BV_TEXTO_MAX) return `O texto tem ${n} caracteres; o máximo é ${BV_TEXTO_MAX}.`;
  if (r.texto.trim() === '' && !r.midiaUrl) return 'Escreve um texto ou escolhe uma imagem.';
  return null;
}

/** Corpo do PUT /creator/boas-vindas. */
export function corpoParaGuardar(r: RascunhoBoasVindas): { texto: string; midiaTipo: 'nenhuma' | 'imagem'; midiaUrl: string | null; ativa: boolean } {
  return { texto: r.texto.trim(), midiaTipo: r.midiaUrl ? 'imagem' : 'nenhuma', midiaUrl: r.midiaUrl, ativa: r.ativa };
}

/** Texto de erro legível: usa o `error` do servidor (em pt-PT) quando existe. */
export function textoErroBoasVindas(e: unknown, acao: 'carregar' | 'guardar' | 'apagar' | 'enviar'): string {
  const status = (e as { status?: number } | null)?.status;
  if (status === 403) {
    const data = (e as { data?: { error?: unknown } } | null)?.data;
    if (data && typeof data.error === 'string' && data.error) return data.error;
    return 'Só criadoras verificadas podem usar a mensagem de boas-vindas.';
  }
  const data = (e as { data?: { error?: unknown } } | null)?.data;
  if (status && status >= 400 && status < 500 && data && typeof data.error === 'string' && data.error) return data.error;
  if (e instanceof Error && (e as { isUpload?: boolean }).isUpload && e.message) return e.message;
  if (status === 429) return 'Demasiados pedidos seguidos. Espera um pouco e tenta de novo.';
  const verbo = { carregar: 'carregar', guardar: 'guardar', apagar: 'apagar', enviar: 'enviar a imagem de' }[acao];
  return `Não foi possível ${verbo === 'enviar a imagem de' ? 'enviar a imagem. Tenta novamente.' : `${verbo} a mensagem. Tenta novamente.`}`;
}
