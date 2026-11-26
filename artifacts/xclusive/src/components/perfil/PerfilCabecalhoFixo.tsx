import { ArrowLeft } from 'lucide-react';
import { PerfilMenu } from './PerfilMenu';
import { cn } from '@/lib/utils';

import { VerifiedIcon } from '@/components/shared/VerifiedIcon';
/**
 * Cabeçalho compacto fixo (seta, nome ✔, ⋮) que surge quando o banner sai do ecrã. Tem a largura da coluna, linha inferior e
 * margem negativa para não empurrar o conteúdo; invisível (e fora da navegação) enquanto o banner está à vista.
 */
export function PerfilCabecalhoFixo({ visivel, nome, verificado, onVoltar, onCopiarLigacao, onDenunciar, onBloquear, bloqueado, usernameBloqueio }: {
  visivel: boolean; nome: string; verificado: boolean; onVoltar: () => void; onCopiarLigacao: () => void; onDenunciar?: () => void; onBloquear?: () => void; bloqueado?: boolean; usernameBloqueio?: string;
}) {
  return (
    <div className={cn('sticky top-0 z-30 -mb-14 flex h-14 items-center justify-between border-b border-border bg-background/95 px-1 backdrop-blur transition-opacity duration-150 motion-reduce:transition-none',
      visivel ? 'visible opacity-100' : 'invisible opacity-0')} data-testid="perfil-cabecalho-fixo" data-visivel={visivel} aria-hidden={!visivel}>
      <div className="flex min-w-0 items-center gap-0.5">
        <button type="button" onClick={onVoltar} aria-label="Voltar" tabIndex={visivel ? 0 : -1} data-testid="perfil-voltar-fixo"
          className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowLeft className="h-5 w-5" aria-hidden="true" /></button>
        <p className="flex min-w-0 items-center gap-1.5 text-base font-bold"><span className="truncate">{nome}</span>
          {verificado && <VerifiedIcon className="h-4 w-4 shrink-0 fill-current text-primary" role="img" aria-label="Verificado" />}</p>
      </div>
      <div className="text-foreground [&_button]:hover:bg-secondary"><PerfilMenu testid="perfil-menu-fixo" onCopiarLigacao={onCopiarLigacao} onDenunciar={onDenunciar} onBloquear={onBloquear} bloqueado={bloqueado} usernameBloqueio={usernameBloqueio} /></div>
    </div>
  );
}
