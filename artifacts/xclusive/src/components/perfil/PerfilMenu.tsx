import { useRef } from 'react';
import { Ban, Flag, Link2, MoreVertical, UserRoundCheck } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

/** Menu ⋮ do perfil: Copiar ligação e (em perfis de outros) Bloquear/Desbloquear e Denunciar perfil. Partilhado pelo banner e pelo cabeçalho compacto. */
export function PerfilMenu({ onCopiarLigacao, onDenunciar, onBloquear, bloqueado, usernameBloqueio, testid = 'perfil-menu' }: { onCopiarLigacao: () => void; onDenunciar?: () => void; onBloquear?: () => void; bloqueado?: boolean; usernameBloqueio?: string; testid?: string }) {
  // Menu → diálogo (bloquear): o foco não volta ao botão do menu depois de o diálogo abrir
  const abriuDialogo = useRef(false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Mais opções do perfil" data-testid={testid}
          className="flex h-11 w-11 items-center justify-center rounded-full text-current transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none">
          <MoreVertical className="h-5 w-5" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52" onCloseAutoFocus={(e) => { if (abriuDialogo.current) { e.preventDefault(); abriuDialogo.current = false; } }}>
        <DropdownMenuItem data-testid="perfil-copiar-ligacao" onSelect={onCopiarLigacao} className="min-h-[44px] gap-2"><Link2 className="h-4 w-4" aria-hidden="true" /> Copiar ligação</DropdownMenuItem>
        {onBloquear && (
          <DropdownMenuItem data-testid="perfil-bloquear" onSelect={() => { abriuDialogo.current = true; onBloquear(); }} className="min-h-[44px] gap-2">
            {bloqueado ? <UserRoundCheck className="h-4 w-4" aria-hidden="true" /> : <Ban className="h-4 w-4 text-destructive" aria-hidden="true" />}
            {bloqueado ? 'Desbloquear' : 'Bloquear'}{usernameBloqueio ? ` @${usernameBloqueio}` : ''}
          </DropdownMenuItem>
        )}
        {onDenunciar && <DropdownMenuItem data-testid="perfil-denunciar" onSelect={onDenunciar} className="min-h-[44px] gap-2 text-destructive focus:text-destructive"><Flag className="h-4 w-4" aria-hidden="true" /> Denunciar perfil</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
