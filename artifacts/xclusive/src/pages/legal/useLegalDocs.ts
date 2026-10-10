import { useEffect, useState } from 'react';

export type LegalDocKey = 'termos' | 'privacidade' | 'conteudo' | 'direitosAutor' | 'reembolsos';
export type LegalDocInfo = { versao: string; atualizadoEm: string };
export type LegalDocs = Record<LegalDocKey, LegalDocInfo>;

/** Páginas legais: rota, título e chave no servidor (fonte única das versões: GET /api/auth/legal-versions). */
export const LEGAL_PAGES: { key: LegalDocKey; path: string; titulo: string }[] = [
  { key: 'termos', path: '/termos', titulo: 'Termos de Serviço' },
  { key: 'privacidade', path: '/privacidade', titulo: 'Política de Privacidade' },
  { key: 'conteudo', path: '/politica-de-conteudo', titulo: 'Política de Conteúdo' },
  { key: 'direitosAutor', path: '/direitos-de-autor', titulo: 'Direitos de Autor (DMCA)' },
  { key: 'reembolsos', path: '/reembolsos', titulo: 'Política de Reembolsos' },
];

export async function fetchLegalDocs(): Promise<LegalDocs> {
  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
  const res = await fetch(`${base}/api/auth/legal-versions`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error('Não foi possível obter as versões dos documentos legais.');
  return (await res.json()) as LegalDocs;
}

/** Versões vigentes dos documentos legais, lidas do servidor (null enquanto carrega ou se falhar). */
export function useLegalDocs(): LegalDocs | null {
  const [docs, setDocs] = useState<LegalDocs | null>(null);
  useEffect(() => {
    let vivo = true;
    fetchLegalDocs().then((d) => { if (vivo) setDocs(d); }).catch(() => { /* a página mostra "versão indisponível" */ });
    return () => { vivo = false; };
  }, []);
  return docs;
}
