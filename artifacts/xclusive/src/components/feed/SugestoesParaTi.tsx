import { useState } from 'react';
import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { SuggestionSkeleton } from '@/components/shared/SkeletonLoaders';
import { useSeguir } from './useSeguir';

interface Sugestao {
  id: number;
  username: string;
  nomeExibicao: string | null;
  avatarUrl: string | null;
  capaUrl?: string | null;
  verificado: boolean;
}

/**
 * "Sugestões para ti": carrossel de cartões (capa do perfil ou fundo neutro com o avatar), etiqueta "Novo no Xclusive",
 * avatar com anel, nome, @handle e Seguir. Setas e pontos de paginação. Os dados carregam UMA vez e ficam em cache (sem intervalos).
 */
export function SugestoesParaTi({ ativo, porPagina = 2 }: { ativo: boolean; porPagina?: 1 | 2 }) {
  const { segue, alternar } = useSeguir();
  const [i, setI] = useState(0);
  const { data, isLoading, isError } = useQuery<Sugestao[]>({
    queryKey: ['/api/users/suggestions'],
    queryFn: async () => {
      const token = localStorage.getItem('xclusive_token');
      const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
      const res = await fetch(`${base}/api/users/suggestions`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error('Falha ao carregar sugestões');
      return await res.json();
    },
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    enabled: ativo,
    retry: 1,
  });
  const lista = (data ?? []).slice(0, 8);
  // Cartões por página: decidido pelo ajuste por medição da coluna (useAjusteColuna): 2, ou 1 se 2 não couberem
  const POR_PAGINA = porPagina;
  const paginas = Math.ceil(lista.length / POR_PAGINA);
  const pag = Math.min(i, Math.max(0, paginas - 1));
  const visiveis = lista.slice(pag * POR_PAGINA, pag * POR_PAGINA + POR_PAGINA);
  const ir = (d: number) => setI((x) => (x + d + paginas) % paginas);
  const seta = 'flex h-[var(--cd-seta,32px)] w-[var(--cd-seta,32px)] items-center justify-center rounded-full text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

  return (
    <section aria-labelledby="sugestoes-titulo" className="cd-sug mb-[var(--cd-gap-a,20px)] shrink-0" data-testid="sugestoes-para-ti">
      <div className="mb-[var(--cd-hmb,12px)] flex items-center justify-between px-0.5">
        <h2 id="sugestoes-titulo" className="text-base font-bold tracking-tight text-foreground">Sugestões para ti</h2>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Sugestões anteriores" disabled={paginas < 2} onClick={() => ir(-1)} data-testid="sugestao-anterior" className={seta}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
          <button type="button" aria-label="Sugestões seguintes" disabled={paginas < 2} onClick={() => ir(1)} data-testid="sugestao-seguinte" className={seta}><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
          <Link href="/explorar" className="ml-1 text-xs font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="sugestoes-ver-todas">Ver todas</Link>
        </div>
      </div>

      {!ativo ? (
        <p className="py-2 text-center text-sm text-muted-foreground">Sem sugestões de momento.</p>
      ) : isLoading ? (
        <SuggestionSkeleton />
      ) : isError ? (
        <p className="py-2 text-center text-sm text-muted-foreground" data-testid="sugestoes-erro">Não foi possível carregar as sugestões.</p>
      ) : visiveis.length === 0 ? (
        <p className="py-2 text-center text-sm text-muted-foreground" data-testid="sugestoes-vazio">Sem sugestões de momento.</p>
      ) : (
        <>
          <div className="flex flex-col gap-[var(--cd-cards-gap,12px)]" style={paginas > 1 ? { minHeight: `calc(${POR_PAGINA} * var(--cd-card, 120px) + ${POR_PAGINA - 1} * var(--cd-cards-gap, 12px))` } : undefined} role="group" aria-label={`Sugestões, página ${pag + 1} de ${paginas}`}>
            {visiveis.map((s) => {
              const aSeguir = segue(s.id, false);
              return (
                <div key={s.id} className="relative h-[var(--cd-card,120px)] shrink-0 overflow-hidden rounded-2xl bg-neutral-800" data-testid="sugestao-cartao">
                  {s.capaUrl ? (
                    <img src={s.capaUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-neutral-700 to-neutral-900" data-testid="sugestao-sem-capa" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/35 to-transparent" aria-hidden="true" />
                  <span className="absolute left-3 top-[var(--cd-card-p,12px)] rounded-full bg-black/55 px-2.5 py-[var(--cd-badge-py,4px)] text-[11px] font-semibold text-white">Novo no Xclusive</span>
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 p-[var(--cd-card-p,12px)]">
                    <Link href={`/perfil/${s.username}`} className="flex min-w-0 items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
                      <Avatar className="h-[var(--cd-card-av,48px)] w-[var(--cd-card-av,48px)] shrink-0 ring-2 ring-white">
                        <AvatarImage src={s.avatarUrl || ''} alt="" />
                        <AvatarFallback>{(s.nomeExibicao || s.username)[0]?.toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold text-white">{s.nomeExibicao || s.username}</span>
                        <span className="block truncate text-xs text-white/85">@{s.username}</span>
                      </span>
                    </Link>
                    <Button variant="ghost" size="sm" className="h-[var(--cd-bt,36px)] shrink-0 rounded-full bg-white px-4 text-xs font-bold text-primary hover:bg-white/90 hover:text-primary dark:text-neutral-900 dark:hover:text-neutral-900" aria-pressed={aSeguir}
                      aria-label={`${aSeguir ? 'A seguir' : 'Seguir'} ${s.username}`} onClick={() => alternar(s.id, s.username, false)} data-testid="sugestao-seguir">
                      {aSeguir ? 'A seguir' : 'Seguir'}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          {paginas > 1 && (
            <div className="mt-[var(--cd-dots,8px)] flex justify-center gap-1.5" role="group" aria-label="Paginação das sugestões" data-testid="sugestao-pontos">
              {Array.from({ length: paginas }, (_, k) => (
                <button key={k} type="button" aria-label={`Ir para a página ${k + 1} das sugestões`} aria-current={k === pag} onClick={() => setI(k)}
                  className="flex h-6 w-6 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className={`h-2 w-2 rounded-full ${k === pag ? 'bg-primary' : 'bg-border'}`} />
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
