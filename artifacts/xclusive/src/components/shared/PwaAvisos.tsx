import { useEffect, useState, useSyncExternalStore } from 'react';
import { Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useDesktop } from '@/hooks/useDesktop';
import { atualizarAgora, CHAVE_AVISO_INSTALAR, gravarFlag, instalarApp, lerEstadoPwa, lerFlag, subscreverPwa } from '@/lib/pwa';

/** Só texto e botões (nada de dinheiro). Em iOS não há prompt nativo: mostra o caminho manual. */
export const TEXTO_IOS = 'Toca em Partilhar e depois em "Adicionar ao ecrã principal".';

export const usePwa = () => useSyncExternalStore(subscreverPwa, lerEstadoPwa, lerEstadoPwa);

/** Item «Instalar app» do menu «Mais»: só para quem ainda não instalou (e só quando o browser permite instalar ou é iOS). */
export function InstalarAppItem() {
  const p = usePwa();
  const [ajuda, setAjuda] = useState(false);
  if (!p.ativo || p.instalada || (!p.podeInstalar && !p.ios)) return null;
  return (
    <>
      <Button
        variant="ghost"
        data-testid="instalar-app-item"
        className="w-full justify-start gap-3 rounded-lg h-11 px-3"
        onClick={() => { if (p.podeInstalar) void instalarApp(); else setAjuda((v) => !v); }}
      >
        <Download className="w-5 h-5" /> Instalar app
      </Button>
      {ajuda && !p.podeInstalar && <p data-testid="instalar-app-ios" className="px-3 pb-1 text-xs text-muted-foreground">{TEXTO_IOS}</p>}
    </>
  );
}

/** Item fixo «Instalar app» das Definições (telemóvel): a mesma lógica do menu «Mais» (prompt nativo; instruções no iOS; escondido se já instalada). */
export function InstalarAppDefinicoes() {
  const p = usePwa();
  const [ajuda, setAjuda] = useState(false);
  if (!p.ativo || p.instalada || (!p.podeInstalar && !p.ios)) return null;
  return (
    <div className="px-4 pt-4 md:hidden" data-testid="instalar-app-definicoes">
      <button
        type="button"
        data-testid="instalar-app-definicoes-botao"
        onClick={() => { if (p.podeInstalar) void instalarApp(); else setAjuda((v) => !v); }}
        className="flex w-full items-center gap-3 rounded-xl border border-border bg-secondary/30 px-4 min-h-[56px] text-left hover:bg-secondary transition-colors"
      >
        <Download className="w-5 h-5 shrink-0" aria-hidden="true" />
        <span className="flex-1 font-semibold">Instalar app</span>
      </button>
      {ajuda && !p.podeInstalar && <p data-testid="instalar-app-definicoes-ios" className="px-1 pt-2 text-sm text-muted-foreground">{TEXTO_IOS}</p>}
    </div>
  );
}

/** Aviso de nova versão (só ao clicar é que a página recarrega) e aviso único, dispensável, para instalar no telemóvel. */
export function PwaAvisos() {
  const p = usePwa();
  const { isAuthenticated } = useAuth();
  const desktop = useDesktop();
  const [aviso, setAviso] = useState<boolean>(() => !lerFlag(CHAVE_AVISO_INSTALAR));
  const mostrarAviso = p.ativo && !p.instalada && isAuthenticated && !desktop && aviso && (p.podeInstalar || p.ios);

  // «Mostrado uma vez»: fica registado logo que aparece, por isso não volta nas visitas seguintes.
  useEffect(() => { if (mostrarAviso) gravarFlag(CHAVE_AVISO_INSTALAR); }, [mostrarAviso]);

  if (!p.novaVersao && !mostrarAviso) return null;
  return (
    <div className="fixed left-3 right-3 bottom-[72px] md:bottom-4 md:left-auto md:right-4 md:w-[360px] z-[60] flex flex-col gap-2">
      {p.novaVersao && (
        <div role="status" data-testid="pwa-nova-versao" className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-lg">
          <span className="flex-1 text-sm">Há uma nova versão do Xclusive.</span>
          <Button size="sm" onClick={atualizarAgora} data-testid="pwa-atualizar">Atualizar</Button>
        </div>
      )}
      {mostrarAviso && (
        <div role="status" data-testid="pwa-aviso-instalar" className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-lg">
          <div className="flex-1 text-sm">
            <p className="font-medium">Instala o Xclusive no teu telemóvel</p>
            {!p.podeInstalar && <p className="text-xs text-muted-foreground mt-1">{TEXTO_IOS}</p>}
          </div>
          {p.podeInstalar && <Button size="sm" onClick={() => { void instalarApp(); setAviso(false); }} data-testid="pwa-aviso-instalar-botao">Instalar</Button>}
          <button type="button" aria-label="Dispensar" data-testid="pwa-aviso-dispensar" onClick={() => setAviso(false)} className="p-1 -mr-1 text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
