import { MoreVertical, RefreshCw, type LucideIcon } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

/** Cabeçalho fixo do feed: "INÍCIO" (ou o título dado, p. ex. "EXPLORAR") e o menu ⋮ (Atualizar), com linha inferior. */
export function FeedHeader({ onAtualizar, aAtualizar, titulo = 'Início', rotuloMenu = 'Mais opções do feed', textoAtualizar = 'Atualizar feed', Icone = RefreshCw, semMenu = false }: { onAtualizar?: () => void; aAtualizar?: boolean; titulo?: string; rotuloMenu?: string; textoAtualizar?: string; Icone?: LucideIcon; semMenu?: boolean }) {
  return (
    <header className="sticky top-0 z-30 flex h-[60px] items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur" data-testid="feed-cabecalho">
      <h1 className="text-xl font-extrabold uppercase tracking-wide text-foreground">{titulo}</h1>
      {!semMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={rotuloMenu}
              data-testid="feed-menu"
              className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <MoreVertical className="h-5 w-5" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem data-testid="feed-atualizar" disabled={aAtualizar} onSelect={() => onAtualizar?.()} className="min-h-[44px] gap-2">
              <Icone className="h-4 w-4" aria-hidden="true" /> {textoAtualizar}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </header>
  );
}
