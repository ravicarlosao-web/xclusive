import { ArrowLeft } from 'lucide-react';
import { PerfilMenu } from './PerfilMenu';
import { cn } from '@/lib/utils';

/**
 * Cabeçalho compacto fixo (seta, nome ✔, ⋮) que surge quando o banner sai do ecrã. Tem a largura da coluna, linha inferior e
 * margem negativa para não empurrar o conteúdo; invisível (e fora da navegação) enquanto o banner está à vista.
 */
export function PerfilCabecalhoFixo({ visivel, nome, verificado, onVoltar, onCopiarLigacao, onDenunciar }: {
  visivel: boolean; nome: string; verificado: boolean; onVoltar: () => void; onCopiarLigacao: () => void; onDenunciar?: () => void;
}) {
  return (
    <div className={cn('sticky top-0 z-30 -mb-14 flex h-14 items-center justify-between border-b border-border bg-background/95 px-1 backdrop-blur transition-opacity duration-150 motion-reduce:transition-none',
      visivel ? 'visible opacity-100' : 'invisible opacity-0')} data-testid="perfil-cabecalho-fixo" data-visivel={visivel} aria-hidden={!visivel}>
      <div className="flex min-w-0 items-center gap-0.5">
        <button type="button" onClick={onVoltar} aria-label="Voltar" tabIndex={visivel ? 0 : -1} data-testid="perfil-voltar-fixo"
          className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowLeft className="h-5 w-5" aria-hidden="true" /></button>
        <p className="flex min-w-0 items-center gap-1.5 text-base font-bold"><span className="truncate">{nome}</span>
          {verificado && <svg className="h-4 w-4 shrink-0 fill-current text-primary" viewBox="0 0 24 24" role="img" aria-label="Verificado"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-1.9 14.7L6 12.6l1.5-1.5 2.6 2.6 6.4-6.4 1.5 1.5-7.9 7.9z" /></svg>}</p>
      </div>
      <div className="text-foreground [&_button]:hover:bg-secondary"><PerfilMenu testid="perfil-menu-fixo" onCopiarLigacao={onCopiarLigacao} onDenunciar={onDenunciar} /></div>
    </div>
  );
}
