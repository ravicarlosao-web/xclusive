import { Link } from 'wouter';
import type { StoryGroup } from '@workspace/api-client-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { StoryCircle } from '@/components/shared/StoryCircle';
import { StorySkeleton } from '@/components/shared/SkeletonLoaders';
import { SeloMais18 } from '@/components/shared/MarcacaoMais18';

export interface LiveAtiva {
  id: number;
  criadorId: number;
  mais18?: boolean;
  criador: { username: string; nomeExibicao: string | null; avatarUrl: string | null };
}

/**
 * Stories e lives numa só linha: "O teu story" (criadoras), depois as LIVES (anel destacado + "AO VIVO"), depois os stories
 * de quem sigo (anel de não visto/visto). Quem tem live e story aparece UMA vez, como live (a live prevalece). A linha
 * desliza na horizontal dentro do seu contentor, sem scroll horizontal da página.
 */
export function StoriesLiveRow({ meuGrupo, grupos, lives, aCarregar, onAdicionar, onVerGrupo, meuId }: {
  meuGrupo: StoryGroup | null;
  grupos: StoryGroup[];
  lives: LiveAtiva[];
  aCarregar: boolean;
  onAdicionar: () => void;
  onVerGrupo: (utilizadorId: number) => void;
  meuId?: number;
}) {
  const livesVisiveis = lives.filter((l) => l.criadorId !== meuId);
  const emLive = new Set(livesVisiveis.map((l) => l.criadorId));
  const soStories = grupos.filter((g) => !emLive.has(g.utilizador.id));

  return (
    <section aria-label="Stories e lives" data-testid="stories-live" className="min-w-0 border-b border-border">
      <div className="flex w-full min-w-0 gap-4 overflow-x-auto px-4 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-testid="stories-live-linha">
        {meuGrupo && (
          <StoryCircle group={meuGrupo} isMe onAdd={onAdicionar} onView={() => onVerGrupo(meuGrupo.utilizador.id)} />
        )}

        {livesVisiveis.map((l) => {
          const nome = l.criador.nomeExibicao ?? l.criador.username;
          return (
            <Link
              key={`live-${l.id}`}
              href={`/live/${l.id}`}
              aria-label={`${nome}, ao vivo`}
              data-testid={`item-live-${l.criadorId}`}
              className="group flex w-[72px] shrink-0 flex-col items-center gap-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="relative">
                <div className="rounded-full p-[2px] ring-2 ring-red-500 ring-offset-2 ring-offset-background">
                  <Avatar className="h-14 w-14 border border-border">
                    <AvatarImage src={l.criador.avatarUrl || ''} alt="" />
                    <AvatarFallback>{nome.slice(0, 1).toUpperCase()}</AvatarFallback>
                  </Avatar>
                </div>
                <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-red-600 px-1.5 py-0.5 text-[9px] font-bold leading-none text-white">
                  AO VIVO
                </span>
                <SeloMais18 mais18={l.mais18} className="absolute -top-1 -right-1 px-1 text-[8px]" />
              </div>
              <span className="mt-1 w-full truncate px-1 text-center text-xs font-medium text-muted-foreground">{l.criador.username}</span>
            </Link>
          );
        })}

        {aCarregar
          ? Array(4).fill(0).map((_, i) => <StorySkeleton key={i} />)
          : soStories.map((g) => (
              <StoryCircle key={g.utilizador.id} group={g} onView={() => onVerGrupo(g.utilizador.id)} />
            ))}

        {/* Sem criadora e sem mais nada: a linha continua visível, com uma indicação discreta */}
        {!meuGrupo && !aCarregar && livesVisiveis.length === 0 && soStories.length === 0 && (
          <p className="flex h-[78px] items-center text-xs text-muted-foreground" data-testid="stories-vazio">Sem stories de momento.</p>
        )}
      </div>
    </section>
  );
}
