import { useRef } from 'react';
import { cn } from '@/lib/utils';

export interface ItemPilula<T extends string> { id: T; rotulo: string }

/**
 * Pílulas em tablist (mesmo desenho das do Início: Tudo/Seguindo/Para ti): o ativo tem aria-selected, setas esquerda/direita
 * mudam de pílula e a fila desliza dentro do seu contentor (sem scroll horizontal da página).
 */
export function Pilulas<T extends string>({ itens, ativo, onMudar, rotulo, painelId, idPrefixo, testid }: {
  itens: ItemPilula<T>[]; ativo: T; onMudar: (id: T) => void; rotulo: string; painelId: string; idPrefixo: string; testid?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function aoTeclar(e: React.KeyboardEvent, i: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const j = (i + (e.key === 'ArrowRight' ? 1 : itens.length - 1)) % itens.length;
    onMudar(itens[j].id);
    refs.current[j]?.focus();
  }
  return (
    <div role="tablist" aria-label={rotulo} className="flex gap-2 overflow-x-auto border-b border-border px-4 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-testid={testid}>
      {itens.map((s, i) => {
        const sel = s.id === ativo;
        return (
          <button
            key={s.id}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            id={`${idPrefixo}-${s.id}`}
            aria-selected={sel}
            aria-controls={painelId}
            tabIndex={sel ? 0 : -1}
            data-testid={`${idPrefixo}-${s.id}`}
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
