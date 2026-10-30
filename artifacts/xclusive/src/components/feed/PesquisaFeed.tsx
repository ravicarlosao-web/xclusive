import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { Search, Hash } from 'lucide-react';
import { useSearch } from '@workspace/api-client-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

/**
 * Caixa de pesquisa da coluna direita. Usa a pesquisa existente (GET /api/search), com debounce de 350 ms e SÓ a partir de
 * 2 caracteres; sem polling. Os resultados saem num menu por baixo da caixa: contas (→ perfil) e hashtags (→ Explorar).
 */
export function PesquisaFeed({ desativada = false }: { desativada?: boolean }) {
  const [texto, setTexto] = useState('');
  const [termo, setTermo] = useState('');
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setTermo(texto.trim()), 350);
    return () => clearTimeout(t);
  }, [texto]);

  useEffect(() => {
    const fora = (e: MouseEvent) => { if (raiz.current && !raiz.current.contains(e.target as Node)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, []);

  const pesquisar = termo.length > 1 && !desativada;
  const { data, isFetching, isError } = useSearch(
    { q: termo },
    { query: { queryKey: ['/api/search', termo], enabled: pesquisar, staleTime: 60_000, retry: 0 } },
  );
  const contas = data?.accounts ?? [];
  const tags = data?.hashtags ?? [];
  const mostrar = aberto && pesquisar;

  return (
    <div ref={raiz} className="relative mb-[var(--cd-gap,20px)] shrink-0" data-testid="pesquisa-feed">
      <div className="flex h-[var(--cd-pesq,44px)] items-center gap-2 rounded-xl border border-border bg-secondary px-4 focus-within:ring-2 focus-within:ring-ring">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          type="search"
          value={texto}
          onChange={(e) => { setTexto(e.target.value); setAberto(true); }}
          onFocus={() => setAberto(true)}
          onKeyDown={(e) => { if (e.key === 'Escape') setAberto(false); }}
          placeholder="Pesquisar criadores, publicações..."
          aria-label="Pesquisar criadores e publicações"
          autoComplete="off"
          data-testid="pesquisa-input"
          className="h-full w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>

      {mostrar && (
        <div role="region" aria-label="Resultados da pesquisa" aria-live="polite" data-testid="pesquisa-resultados"
          className="absolute left-0 right-0 top-[calc(var(--cd-pesq,44px)+4px)] z-40 max-h-80 overflow-y-auto rounded-2xl border border-border bg-card p-2 shadow-lg">
          {isFetching && <p className="px-3 py-2 text-xs text-muted-foreground">A pesquisar…</p>}
          {isError && <p className="px-3 py-2 text-xs text-muted-foreground" data-testid="pesquisa-erro">Não foi possível pesquisar. Tenta novamente.</p>}
          {!isFetching && !isError && contas.length === 0 && tags.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground" data-testid="pesquisa-sem-resultados">Sem resultados para «{termo}».</p>
          )}
          {contas.map((c) => (
            <Link key={c.id} href={`/perfil/${c.username}`} onClick={() => setAberto(false)}
              className="flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-1.5 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="pesquisa-conta">
              <Avatar className="h-8 w-8 border border-border">
                <AvatarImage src={c.avatarUrl || ''} alt="" />
                <AvatarFallback className="text-xs">{(c.nomeExibicao || c.username).slice(0, 1).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-foreground">{c.username}</span>
                <span className="block truncate text-xs text-muted-foreground">{c.nomeExibicao}</span>
              </span>
            </Link>
          ))}
          {tags.map((t) => (
            <Link key={t.nome} href="/explorar" onClick={() => setAberto(false)}
              className="flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-1.5 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="pesquisa-hashtag">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary"><Hash className="h-4 w-4" aria-hidden="true" /></span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-foreground">#{t.nome}</span>
                <span className="block text-xs text-muted-foreground">{t.totalPosts} {t.totalPosts === 1 ? 'publicação' : 'publicações'}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
