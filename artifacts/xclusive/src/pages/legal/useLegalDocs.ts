import { useCallback, useEffect, useState } from 'react';
import { validarConfig, type LegalConfig } from './resolver';

export type LegalDocKey = 'termos' | 'privacidade' | 'conteudo' | 'direitosAutor' | 'reembolsos';
export type LegalDocInfo = { versao: string; atualizadoEm: string };
export type LegalDocs = Record<LegalDocKey, LegalDocInfo>;

/** Páginas legais: rota, título e chave no servidor (fonte única das versões: GET /api/auth/legal-versions). */
/** `curto`: nome curto para o rodapé e listas compactas. */
export const LEGAL_PAGES: { key: LegalDocKey; path: string; titulo: string; curto: string }[] = [
  { key: 'termos', path: '/termos', titulo: 'Termos de Serviço', curto: 'Termos de Serviço' },
  { key: 'privacidade', path: '/privacidade', titulo: 'Política de Privacidade', curto: 'Política de Privacidade' },
  { key: 'conteudo', path: '/politica-de-conteudo', titulo: 'Política de Conteúdo', curto: 'Política de Conteúdo' },
  { key: 'direitosAutor', path: '/direitos-de-autor', titulo: 'Direitos de Autor (DMCA)', curto: 'Direitos de Autor' },
  { key: 'reembolsos', path: '/reembolsos', titulo: 'Política de Reembolsos', curto: 'Reembolsos' },
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

/** Dados variáveis dos textos legais (empresa, email, mínimo e prazos de levantamento): GET /api/auth/legal-config. */
export async function fetchLegalConfig(): Promise<LegalConfig> {
  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
  const res = await fetch(`${base}/api/auth/legal-config`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error('Não foi possível obter a configuração dos textos legais.');
  return validarConfig(await res.json());
}

export type EstadoLegalConfig = { config: LegalConfig | null; erro: boolean; tentarOutraVez: () => void };

// Cache simples (variável de módulo): evita um pedido novo por montagem (rodapé + páginas legais). Só guarda sucessos;
// uma falha não fica em cache. Expira ao fim de 5 min para que uma alteração da configuração acabe por chegar.
const CACHE_MS = 5 * 60 * 1000;
let cache: { config: LegalConfig; em: number } | null = null;
let emCurso: Promise<LegalConfig> | null = null;

function configEmCache(): LegalConfig | null {
  return cache && Date.now() - cache.em < CACHE_MS ? cache.config : null;
}

function carregarConfig(): Promise<LegalConfig> {
  if (!emCurso) {
    emCurso = fetchLegalConfig()
      .then((c) => { cache = { config: c, em: Date.now() }; return c; })
      .finally(() => { emCurso = null; });
  }
  return emCurso;
}

/** Esquece a cache (para os testes e para "Tentar novamente"). */
export function limparCacheLegalConfig(): void { cache = null; }

/** legal-config para as páginas legais e o rodapé: config é null enquanto carrega; erro=true se falhar ou vier incompleto. */
export function useLegalConfig(ativo = true): EstadoLegalConfig {
  const [config, setConfig] = useState<LegalConfig | null>(configEmCache);
  const [erro, setErro] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  useEffect(() => {
    let vivo = true;
    setErro(false);
    if (!ativo) return () => { vivo = false; };
    const guardada = configEmCache();
    if (guardada) { setConfig(guardada); return () => { vivo = false; }; }
    carregarConfig().then((c) => { if (vivo) setConfig(c); }).catch(() => { if (vivo) setErro(true); });
    return () => { vivo = false; };
  }, [tentativa, ativo]);
  const tentarOutraVez = useCallback(() => { limparCacheLegalConfig(); setConfig(null); setTentativa((n) => n + 1); }, []);
  return { config, erro, tentarOutraVez };
}
