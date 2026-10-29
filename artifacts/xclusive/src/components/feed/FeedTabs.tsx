import { useRef } from 'react';
import { cn } from '@/lib/utils';

export type FiltroFeed = 'tudo' | 'seguindo' | 'para-ti' | 'em-alta';
export const SEPARADORES: { id: FiltroFeed; rotulo: string }[] = [
  { id: 'tudo', rotulo: 'Tudo' },
  { id: 'seguindo', rotulo: 'Seguindo' },
  { id: 'para-ti', rotulo: 'Para ti' },
  { id: 'em-alta', rotulo: 'Em alta' },
];

/** Separadores em pílula (tablist): o ativo comanda a única chamada ao feed. Setas esquerda/direita mudam de separador. */
export function FeedTabs({ ativo, onMudar }: { ativo: FiltroFeed; onMudar: (f: FiltroFeed) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function aoTeclar(e: React.KeyboardEvent, i: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const j = (i + (e.key === 'ArrowRight' ? 1 : SEPARADORES.length - 1)) % SEPARADORES.length;
    onMudar(SEPARADORES[j].id);
    refs.current[j]?.focus();
  }
  return (
    <div role="tablist" aria-label="Filtrar o feed" className="flex gap-2 overflow-x-auto px-4 pb-3 pt-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-testid="feed-separadores">
      {SEPARADORES.map((s, i) => {
        const sel = s.id === ativo;
        return (
          <button
            key={s.id}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            id={`feed-tab-${s.id}`}
            aria-selected={sel}
            aria-controls="feed-painel"
            tabIndex={sel ? 0 : -1}
            data-testid={`feed-tab-${s.id}`}
            onClick={() => onMudar(s.id)}
            onKeyDown={(e) => aoTeclar(e, i)}
            className={cn(
              'min-h-[44px] shrink-0 rounded-full px-5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              sel ? 'bg-primary/10 font-bold text-primary' : 'bg-secondary text-muted-foreground hover:text-foreground',
            )}
          >
            {s.rotulo}
          </button>
        );
      })}
    </div>
  );
}
