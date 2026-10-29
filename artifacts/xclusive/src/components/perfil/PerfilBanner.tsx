import { ArrowLeft, Flag, Image as ImagemIcone, Link2, MoreVertical, Users } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const Verificado = () => (
  <svg className="h-5 w-5 shrink-0 fill-current text-white" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-1.9 14.7L6 12.6l1.5-1.5 2.6 2.6 6.4-6.4 1.5 1.5-7.9 7.9z" /></svg>
);

export interface EstatisticasPerfil {
  publicacoes: number | null;
  fas: number | null;
  seguindo: number | null;
}

/**
 * Faixa de capa (proporção 10:3) com scrim escuro para o texto por cima ser legível com ou sem imagem. `capaUrl` é o único ponto
 * de entrada da imagem (hoje definida em Definições); sem capa mostra o cinzento neutro do tema. Seta de voltar, nome e estatísticas
 * em cima à esquerda; menu ⋮ (copiar ligação, denunciar) em cima à direita.
 */
export function PerfilBanner({ capaUrl, nome, verificado, stats, onVoltar, onAbrirFas, onAbrirSeguindo, onCopiarLigacao, onDenunciar }: {
  capaUrl?: string | null;
  nome: string;
  verificado: boolean;
  stats: EstatisticasPerfil;
  onVoltar: () => void;
  onAbrirFas: () => void;
  onAbrirSeguindo: () => void;
  onCopiarLigacao: () => void;
  onDenunciar?: () => void;
}) {
  const btn = 'flex h-11 w-11 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white';
  const tem = stats.publicacoes !== null || stats.fas !== null || stats.seguindo !== null;
  return (
    <div className="relative aspect-[10/3] min-h-[132px] w-full overflow-hidden bg-secondary" data-testid="perfil-banner">
      {capaUrl ? <img src={capaUrl} alt="" className="absolute inset-0 h-full w-full object-cover" data-testid="perfil-capa" /> : <div className="absolute inset-0 bg-gradient-to-r from-secondary to-background" data-testid="perfil-sem-capa" />}
      <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/50 to-black/20" aria-hidden="true" data-testid="perfil-scrim" />

      <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 px-1 pt-1 text-white">
        <div className="flex min-w-0 items-start gap-0.5">
          <button type="button" onClick={onVoltar} aria-label="Voltar" className={btn} data-testid="perfil-voltar"><ArrowLeft className="h-5 w-5" aria-hidden="true" /></button>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 pt-2.5 text-base font-bold leading-tight sm:text-lg" aria-hidden="true"><span className="truncate">{nome}</span>{verificado && <Verificado />}</p>
            {tem && (
        <ul className="flex items-center gap-3 text-xs font-medium text-white sm:text-sm" data-testid="perfil-stats" aria-label="Estatísticas do perfil">
          {stats.publicacoes !== null && <li className="flex min-h-[44px] items-center gap-1"><ImagemIcone className="h-3.5 w-3.5" aria-hidden="true" /><span><b>{stats.publicacoes}</b> publicações</span></li>}
          {stats.fas !== null && <li><button type="button" onClick={onAbrirFas} className="flex min-h-[44px] items-center gap-1 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white" data-testid="perfil-fas"><Users className="h-3.5 w-3.5" aria-hidden="true" /><span><b>{stats.fas}</b> fãs</span></button></li>}
          {stats.seguindo !== null && <li><button type="button" onClick={onAbrirSeguindo} className="flex min-h-[44px] items-center gap-1 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white" data-testid="perfil-a-seguir"><span><b>{stats.seguindo}</b> a seguir</span></button></li>}
        </ul>
        )}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Mais opções do perfil" className={btn} data-testid="perfil-menu"><MoreVertical className="h-5 w-5" aria-hidden="true" /></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem data-testid="perfil-copiar-ligacao" onSelect={onCopiarLigacao} className="min-h-[44px] gap-2"><Link2 className="h-4 w-4" aria-hidden="true" /> Copiar ligação</DropdownMenuItem>
            {onDenunciar && <DropdownMenuItem data-testid="perfil-denunciar" onSelect={onDenunciar} className="min-h-[44px] gap-2 text-destructive focus:text-destructive"><Flag className="h-4 w-4" aria-hidden="true" /> Denunciar perfil</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

    </div>
  );
}
