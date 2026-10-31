import { useRef, useState } from 'react';
import { Flag, MoreHorizontal } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const PRESSAO_LONGA_MS = 500;

/**
 * Menu "Opções da mensagem" de uma mensagem RECEBIDA (nunca das próprias nem das retiradas): hoje só "Denunciar mensagem".
 * Desktop: o botão aparece ao passar o rato ou ao focar; abaixo de md fica sempre visível. Também abre com pressão longa
 * (toque) ou botão direito na bolha. O botão tem 44 px. Quem chama recebe o botão, para devolver o foco quando o diálogo fecha.
 */
export function OpcoesMensagem({ children, onDenunciar }: { children: React.ReactNode; onDenunciar: (gatilho: HTMLElement | null) => void }) {
  const [aberto, setAberto] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abriuDialogo = useRef(false);
  const parar = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };

  return (
    <div
      className="group/linha flex min-w-0 max-w-[calc(100%-2.5rem)] items-center sm:max-w-[80%]"
      onTouchStart={() => { parar(); timer.current = setTimeout(() => { timer.current = null; setAberto(true); }, PRESSAO_LONGA_MS); }}
      onTouchMove={parar} onTouchEnd={parar} onTouchCancel={parar}
      onContextMenu={(e) => { e.preventDefault(); setAberto(true); }}
    >
      {children}
      <DropdownMenu open={aberto} onOpenChange={setAberto}>
        <DropdownMenuTrigger asChild>
          <button ref={botao} type="button" aria-label="Opções da mensagem" data-testid="msg-opcoes"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-opacity hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:opacity-100 md:opacity-0 md:group-hover/linha:opacity-100 md:focus-visible:opacity-100 data-[state=open]:opacity-100">
            <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56"
          onCloseAutoFocus={(e) => { if (abriuDialogo.current) { e.preventDefault(); abriuDialogo.current = false; } }}>
          <DropdownMenuItem data-testid="msg-denunciar" className="min-h-[44px] gap-2"
            onSelect={() => { abriuDialogo.current = true; onDenunciar(botao.current); }}>
            <Flag className="h-4 w-4 text-destructive" aria-hidden="true" /> Denunciar mensagem
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Marcador discreto de uma mensagem retirada pela moderação (para os dois lados): sem conteúdo, imagem nem valor. */
export function MensagemRemovida() {
  return (
    <div data-testid="msg-removida" className="rounded-2xl border border-dashed border-border px-4 py-2.5 text-sm italic text-muted-foreground">
      Mensagem removida pela moderação
    </div>
  );
}
