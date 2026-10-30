import { useState } from 'react';
import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { ChevronUp } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

interface Sugestao { id: number; username: string; nomeExibicao: string | null; avatarUrl: string | null; capaUrl?: string | null; verificado: boolean; tipoConta?: string }

/**
 * "Outras criadoras": carrossel horizontal (scroll-snap, 2 cartões inteiros e o terceiro cortado) com as sugestões que o feed já
 * pede. Mesma chave e mesma função de pedido que o feed => UMA chamada em cache (10 min), sem intervalos. Exclui a pessoa
 * autenticada (o servidor já o faz) e o perfil aberto; só criadoras; sem dados, o bloco não aparece.
 */
export function OutrasCriadoras({ ativo, perfilUsername, meuUsername }: { ativo: boolean; perfilUsername: string; meuUsername?: string }) {
  const [aberto, setAberto] = useState(true);
  const { data } = useQuery<Sugestao[]>({
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
  const lista = (data ?? []).filter((u) => u.username !== perfilUsername && u.username !== meuUsername && (u.tipoConta === undefined || u.tipoConta === 'criador')).slice(0, 8);
  if (!ativo || lista.length === 0) return null;
  return (
    <section aria-labelledby="outras-criadoras-titulo" className="cd-outras mb-[var(--cd-gap,24px)] shrink-0 rounded-xl border border-border p-3" data-testid="outras-criadoras">
      <div className="flex items-center justify-between">
        <h2 id="outras-criadoras-titulo" className="text-xs font-extrabold uppercase tracking-wide text-foreground">Outras criadoras</h2>
        <button type="button" onClick={() => setAberto((a) => !a)} aria-expanded={aberto} aria-controls="outras-criadoras-lista" aria-label={aberto ? 'Recolher outras criadoras' : 'Expandir outras criadoras'} data-testid="outras-criadoras-alternar"
          className="-mr-2 flex h-[var(--cd-seta,44px)] min-h-[32px] w-[var(--cd-seta,44px)] min-w-[32px] items-center justify-center rounded-full hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronUp className={cn('h-5 w-5 transition-transform motion-reduce:transition-none', !aberto && 'rotate-180')} aria-hidden="true" />
        </button>
      </div>
      <ul id="outras-criadoras-lista" hidden={!aberto} className="mt-1 flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-testid="outras-criadoras-lista">
        {lista.map((u) => (
          <li key={u.id} className="w-[150px] shrink-0 snap-start">
            <Link href={`/perfil/${u.username}`} className="block overflow-hidden rounded-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="outras-criadoras-cartao">
              <div className="relative h-[var(--cd-capa,64px)] bg-secondary">{u.capaUrl && <img src={u.capaUrl} alt="" loading="lazy" className="h-full w-full object-cover" />}</div>
              <div className="relative px-2 pb-2 text-center">
                <Avatar className="-mt-[calc(var(--cd-capa,64px)/2)] mx-auto h-[var(--cd-capa,64px)] w-[var(--cd-capa,64px)] ring-4 ring-background"><AvatarImage src={u.avatarUrl || ''} alt="" className="object-cover" /><AvatarFallback>{(u.nomeExibicao || u.username)[0]?.toUpperCase()}</AvatarFallback></Avatar>
                <p className="mt-1 flex items-center justify-center gap-1 text-sm font-semibold leading-5 text-foreground"><span className="truncate">{u.nomeExibicao || u.username}</span>
                  {u.verificado && <svg className="h-3.5 w-3.5 shrink-0 fill-current text-primary" viewBox="0 0 24 24" role="img" aria-label="Verificado"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-1.9 14.7L6 12.6l1.5-1.5 2.6 2.6 6.4-6.4 1.5 1.5-7.9 7.9z" /></svg>}</p>
                <p className="truncate text-xs text-muted-foreground">@{u.username}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
