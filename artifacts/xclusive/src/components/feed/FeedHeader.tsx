import { MoreVertical, RefreshCw } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

/** Cabeçalho fixo do feed: "INÍCIO" e o menu ⋮ (Atualizar feed), com linha inferior. */
export function FeedHeader({ onAtualizar, aAtualizar }: { onAtualizar: () => void; aAtualizar?: boolean }) {
  return (
    <header className="sticky top-0 z-30 flex h-[60px] items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur" data-testid="feed-cabecalho">
      <h1 className="text-xl font-extrabold uppercase tracking-wide text-foreground">Início</h1>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Mais opções do feed"
            data-testid="feed-menu"
            className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MoreVertical className="h-5 w-5" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem data-testid="feed-atualizar" disabled={aAtualizar} onSelect={onAtualizar} className="min-h-[44px] gap-2">
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Atualizar feed
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
