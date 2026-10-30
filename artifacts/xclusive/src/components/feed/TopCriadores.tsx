import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { Flame, WifiOff } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { SuggestionSkeleton } from '@/components/shared/SkeletonLoaders';
import { useSeguir } from './useSeguir';

export interface TopCreator {
  id: number;
  username: string;
  nomeExibicao: string;
  avatarUrl: string | null;
  verificado: boolean;
  tipoConta?: string;
  totalPublicacoes: number;
  estaASeguir?: boolean;
}

const Verificado = () => (
  <svg className="h-3.5 w-3.5 shrink-0 fill-current text-primary" viewBox="0 0 24 24" role="img" aria-label="Verificado"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-1.9 14.7L6 12.6l1.5-1.5 2.6 2.6 6.4-6.4 1.5 1.5-7.9 7.9z" /></svg>
);

/** Top Criadores: chama, "Ver todos", posição, avatar, nome, verificado, nome de exibição, "N posts" e Seguir. Uma chamada, em cache. */
export function TopCriadores({ ativo }: { ativo: boolean }) {
  const { segue, alternar } = useSeguir();
  const { data, isLoading, isError } = useQuery<TopCreator[]>({
    queryKey: ['/api/users/top-creators'],
    queryFn: async () => {
      const token = localStorage.getItem('xclusive_token');
      const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
      const res = await fetch(`${base}/api/users/top-creators`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error('Falha ao carregar top criadores');
      return await res.json();
    },
    staleTime: 5 * 60_000,
    enabled: ativo,
    retry: 1,
  });
  const criadores = (ativo && data ? data : []).slice(0, 5);

  return (
    <section aria-labelledby="top-criadores-titulo" className="cd-top mb-6 shrink-0" data-testid="top-criadores">
      <div className="mb-3 flex items-center justify-between px-0.5">
        <h2 id="top-criadores-titulo" className="flex items-center gap-2 text-base font-bold tracking-tight text-foreground">
          <Flame className="h-5 w-5 fill-orange-400 text-orange-500" aria-hidden="true" /> Top Criadores
        </h2>
        <Link href="/explorar" className="text-xs font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="top-ver-todos">Ver todos</Link>
      </div>

      <div className="flex flex-col gap-1.5">
        {!ativo ? (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">Sem ligação à base de dados.</p>
        ) : isLoading ? (
          Array(3).fill(0).map((_, i) => <SuggestionSkeleton key={i} />)
        ) : isError ? (
          <div className="flex flex-col items-center gap-2 px-2 py-4" data-testid="top-erro">
            <WifiOff className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <p className="text-center text-xs text-muted-foreground">Não foi possível carregar o ranking.</p>
          </div>
        ) : criadores.length > 0 ? (
          criadores.map((c, i) => {
            const aSeguir = segue(c.id, !!c.estaASeguir);
            return (
              <div key={c.id} className="cd-top-linha flex items-center justify-between gap-2 rounded-xl border border-border bg-card p-3 transition-colors hover:bg-secondary/70" data-testid="top-linha">
                <Link href={`/perfil/${c.username}`} className="flex min-w-0 flex-1 items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-xs font-black text-foreground" aria-label={`Posição ${i + 1}`}>{i + 1}</span>
                  <Avatar className="h-12 w-12 shrink-0 border border-border">
                    <AvatarImage src={c.avatarUrl || ''} alt="" />
                    <AvatarFallback className="text-xs font-bold">{c.nomeExibicao?.[0] || c.username[0]}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 text-sm font-bold text-foreground"><span className="truncate">{c.username}</span>{c.verificado && <Verificado />}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{c.nomeExibicao}</span>
                    <span className="block text-[11px] text-muted-foreground">{c.totalPublicacoes} {c.totalPublicacoes === 1 ? 'post' : 'posts'}</span>
                  </span>
                </Link>
                <Button variant="ghost" size="sm" aria-pressed={aSeguir} aria-label={`${aSeguir ? 'A seguir' : 'Seguir'} ${c.username}`}
                  className="h-9 shrink-0 rounded-lg bg-primary/15 px-4 text-xs font-bold text-primary hover:bg-primary/25 hover:text-primary" onClick={() => alternar(c.id, c.username, !!c.estaASeguir)}>
                  {aSeguir ? 'A seguir' : 'Seguir'}
                </Button>
              </div>
            );
          })
        ) : (
          <p className="py-3 text-center text-xs text-muted-foreground">Ainda não há criadores com publicações.</p>
        )}
      </div>
    </section>
  );
}
