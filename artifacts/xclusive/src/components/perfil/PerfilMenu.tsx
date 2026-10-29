import { Flag, Link2, MoreVertical } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

/** Menu ⋮ do perfil: Copiar ligação e (em perfis de outros) Denunciar perfil. Partilhado pelo banner e pelo cabeçalho compacto. */
export function PerfilMenu({ onCopiarLigacao, onDenunciar, testid = 'perfil-menu' }: { onCopiarLigacao: () => void; onDenunciar?: () => void; testid?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Mais opções do perfil" data-testid={testid}
          className="flex h-11 w-11 items-center justify-center rounded-full text-current transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none">
          <MoreVertical className="h-5 w-5" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem data-testid="perfil-copiar-ligacao" onSelect={onCopiarLigacao} className="min-h-[44px] gap-2"><Link2 className="h-4 w-4" aria-hidden="true" /> Copiar ligação</DropdownMenuItem>
        {onDenunciar && <DropdownMenuItem data-testid="perfil-denunciar" onSelect={onDenunciar} className="min-h-[44px] gap-2 text-destructive focus:text-destructive"><Flag className="h-4 w-4" aria-hidden="true" /> Denunciar perfil</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
