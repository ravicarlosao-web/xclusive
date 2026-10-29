/**
 * Envia UMA imagem pelo upload existente (POST /api/upload, os mesmos limites e validações do servidor) e devolve o URL canónico
 * (a guardar, absoluto) e o URL assinado para mostrar já. Usado pelo avatar (Definições) e pelo banner (perfil).
 */
export async function enviarImagem(file: File): Promise<{ url: string; urlVisualizacao: string | null }> {
  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
  const formData = new FormData();
  formData.append('files', file);
  const token = localStorage.getItem('xclusive_token');
  const res = await fetch(`${base}/api/upload`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  if (!res.ok) throw new Error('Erro no upload');
  const data = await res.json();
  const relativeUrl = data.files?.[0]?.url;
  const urlVisualizacao = data.files?.[0]?.urlVisualizacao;
  if (!relativeUrl) throw new Error('URL não devolvida pelo servidor');
  // O backend valida com z.url(), que requer URL absoluto
  return {
    url: new URL(relativeUrl, window.location.origin).href,
    urlVisualizacao: urlVisualizacao ? new URL(urlVisualizacao, window.location.origin).href : null,
  };
}
