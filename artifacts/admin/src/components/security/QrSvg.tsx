import { useMemo } from 'react';
import encodeQR from 'qr';

/**
 * Código QR desenhado como SVG construído em React (sem imagens data:, sem dangerouslySetInnerHTML, sem serviços externos).
 * A matriz vem da biblioteca `qr` (paulmillr, sem dependências); o texto (URI otpauth, que leva o segredo) nunca sai deste componente nem do navegador.
 * Módulos pretos sobre fundo branco com margem de 4 módulos (como pede a norma), para ler bem em qualquer tema.
 */
export function QrSvg({ texto, rotulo, className }: { texto: string; rotulo: string; className?: string }) {
  const { d, lado } = useMemo(() => {
    const m = encodeQR(texto, 'raw') as boolean[][];
    const margem = 4, n = m.length;
    let caminho = '';
    m.forEach((linha, y) => {
      let x = 0;
      while (x < n) {
        if (!linha[x]) { x++; continue; }
        let f = x; while (f < n && linha[f]) f++;
        caminho += `M${x + margem} ${y + margem}h${f - x}v1h-${f - x}z`;   // uma barra por sequência de módulos escuros
        x = f;
      }
    });
    return { d: caminho, lado: n + margem * 2 };
  }, [texto]);
  return (
    <svg role="img" aria-label={rotulo} viewBox={`0 0 ${lado} ${lado}`} className={className} shapeRendering="crispEdges" data-testid="qr-totp">
      <title>{rotulo}</title>
      <rect width={lado} height={lado} fill="#ffffff" />
      <path d={d} fill="#000000" />
    </svg>
  );
}
