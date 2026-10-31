import { getFreshAuthToken } from '@workspace/api-client-react';

/** Só o que o servidor aceita nas mensagens: JPG, PNG e WebP (sem GIF nem vídeo), até 10 MB. */
export const TIPOS_IMAGEM = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const ACCEPT_IMAGEM = TIPOS_IMAGEM.join(',');
export const MAX_BYTES_IMAGEM = 10 * 1024 * 1024;

/** Mensagem em pt-PT se o ficheiro não serve, ou null. */
export function validarImagem(file: File): string | null {
  if (!(TIPOS_IMAGEM as readonly string[]).includes(file.type)) return 'Só são aceites imagens JPG, PNG ou WebP.';
  if (file.size > MAX_BYTES_IMAGEM) return 'A imagem excede o limite de 10 MB.';
  if (file.size === 0) return 'O ficheiro está vazio.';
  return null;
}

/** Texto de erro a mostrar (usa o `error` do servidor quando existe, p. ex. num 400). */
export function textoErro(e: unknown): string {
  const data = (e as { data?: { error?: unknown } } | null)?.data;
  if (data && typeof data.error === 'string' && data.error) return data.error;
  if (e instanceof Error && e.message && (e as { isUpload?: boolean }).isUpload) return e.message;
  return 'Não foi possível enviar a imagem. Tenta novamente.';
}

/** Envia UMA imagem por POST /api/upload e devolve o URL canónico (sem token) a guardar na mensagem. */
export async function enviarImagemMensagem(file: File): Promise<string> {
  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
  const form = new FormData();
  form.append('files', file);
  const token = await getFreshAuthToken();
  const res = await fetch(`${base}/api/upload`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    const e = new Error(j?.error || 'Não foi possível enviar a imagem. Tenta novamente.') as Error & { isUpload?: boolean };
    e.isUpload = true;
    throw e;
  }
  const data = (await res.json()) as { files?: { url?: string }[] };
  const url = data.files?.[0]?.url;
  if (!url) throw Object.assign(new Error('Não foi possível enviar a imagem. Tenta novamente.'), { isUpload: true });
  return new URL(url, window.location.origin).href;
}
