import { useEffect } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

export interface ImagemVista { id: number; url: string; legenda?: string | null; autor: string }

const BOTAO = 'flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white';

/**
 * Visualizador em ecrã inteiro das imagens da conversa: role=dialog/aria-modal (Radix: foco preso, Esc, foco devolvido ao
 * elemento que o abriu), fundo escuro, fechar de 44 px, tocar fora fecha, setas ←/→ e botões entre imagens.
 */
export function VisualizadorImagens({ imagens, indice, onMudar, onFechar }: { imagens: ImagemVista[]; indice: number | null; onMudar: (i: number) => void; onFechar: () => void }) {
  const aberto = indice !== null && imagens[indice] !== undefined;
  const img = aberto ? imagens[indice as number] : null;
  useEffect(() => {
    if (!aberto) return;
    const t = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && (indice as number) > 0) { e.preventDefault(); onMudar((indice as number) - 1); }
      if (e.key === 'ArrowRight' && (indice as number) < imagens.length - 1) { e.preventDefault(); onMudar((indice as number) + 1); }
    };
    window.addEventListener('keydown', t);
    return () => window.removeEventListener('keydown', t);
  }, [aberto, indice, imagens.length, onMudar]);

  return (
    <DialogPrimitive.Root open={aberto} onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content aria-describedby={undefined} aria-modal="true" data-testid="visualizador"
          className="fixed inset-0 z-[100] flex flex-col bg-black outline-none"
          onClick={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
          <DialogPrimitive.Title className="sr-only">{img ? `Imagem ${(indice as number) + 1} de ${imagens.length}, enviada por ${img.autor}` : 'Imagem'}</DialogPrimitive.Title>
          <div className="flex shrink-0 items-center justify-between p-3 text-white" onClick={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
            <span className="px-2 text-sm" aria-hidden="true">{img ? `${(indice as number) + 1} / ${imagens.length}` : ''}</span>
            <DialogPrimitive.Close className={BOTAO} aria-label="Fechar visualizador" data-testid="visualizador-fechar"><X className="h-6 w-6" aria-hidden="true" /></DialogPrimitive.Close>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4 md:px-16" onClick={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
            {img && <img key={img.id} src={img.url} alt={img.legenda ? `Imagem: ${img.legenda}` : `Imagem enviada por ${img.autor}`} data-testid="visualizador-imagem" className="max-h-full max-w-full rounded-lg object-contain" />}
            {aberto && (indice as number) > 0 && <button type="button" className={`${BOTAO} absolute left-2 top-1/2 -translate-y-1/2 md:left-4`} aria-label="Imagem anterior" data-testid="visualizador-anterior" onClick={() => onMudar((indice as number) - 1)}><ChevronLeft className="h-6 w-6" aria-hidden="true" /></button>}
            {aberto && (indice as number) < imagens.length - 1 && <button type="button" className={`${BOTAO} absolute right-2 top-1/2 -translate-y-1/2 md:right-4`} aria-label="Imagem seguinte" data-testid="visualizador-seguinte" onClick={() => onMudar((indice as number) + 1)}><ChevronRight className="h-6 w-6" aria-hidden="true" /></button>}
          </div>
          {img?.legenda && <p className="shrink-0 px-4 pb-4 text-center text-sm text-white" onClick={(e) => { if (e.target === e.currentTarget) onFechar(); }}>{img.legenda}</p>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
