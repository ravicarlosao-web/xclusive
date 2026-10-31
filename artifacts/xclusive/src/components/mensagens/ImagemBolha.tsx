import { useState } from 'react';

/**
 * Imagem dentro da bolha: esqueleto com proporção reservada até carregar, depois a proporção real (máx. 260×320),
 * cantos arredondados e a própria bolha abre o visualizador. Falha → aviso sem partir o layout.
 */
export function ImagemBolha({ src, legenda, autor, onAbrir, onCarregada }: { src: string; legenda?: string | null; autor: string; onAbrir: (el: HTMLButtonElement) => void; onCarregada?: () => void }) {
  const [estado, setEstado] = useState<'a_carregar' | 'ok' | 'erro'>('a_carregar');
  return (
    <button type="button" data-testid="msg-imagem" onClick={(e) => onAbrir(e.currentTarget)} aria-label={`Abrir imagem enviada por ${autor}${legenda ? `: ${legenda}` : ''}`}
      className="relative block max-w-[260px] overflow-hidden rounded-2xl border border-border bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {estado === 'a_carregar' && <span data-testid="msg-imagem-esqueleto" aria-hidden="true" className="block aspect-[4/3] w-[220px] max-w-full animate-pulse bg-secondary" />}
      {estado === 'erro' && <span className="flex aspect-[4/3] w-[220px] max-w-full items-center justify-center px-3 text-center text-xs text-muted-foreground">Imagem indisponível</span>}
      {estado !== 'erro' && (
        <img src={src} alt={legenda ? `Imagem: ${legenda}` : `Imagem enviada por ${autor}`} loading="lazy" decoding="async"
          onLoad={() => { setEstado('ok'); onCarregada?.(); }} onError={() => setEstado('erro')}
          className={estado === 'ok' ? 'block h-auto max-h-[320px] w-auto max-w-full object-contain' : 'absolute h-0 w-0 opacity-0'} />
      )}
    </button>
  );
}
