import { cn } from '@/lib/utils';

interface UploadProgressCircleProps {
  /** Percentagem real (0-100). null/undefined = indeterminado: o círculo roda e não mostra número. */
  percent?: number | null;
  size?: number;
  className?: string;
}

/** Círculo de progresso dos carregamentos (imagem, vídeo, story): só o círculo e a percentagem ao centro, sem texto. */
export function UploadProgressCircle({ percent, size = 112, className }: UploadProgressCircleProps) {
  const determinado = typeof percent === 'number' && Number.isFinite(percent);
  const valor = determinado ? Math.min(100, Math.max(0, Math.round(percent as number))) : 0;
  const stroke = Math.max(6, Math.round(size / 14));
  const raio = (size - stroke) / 2;
  const circunferencia = 2 * Math.PI * raio;

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={determinado ? valor : undefined}
      data-testid="upload-progress-circle"
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className={cn('-rotate-90', !determinado && 'animate-spin')}
        aria-hidden
      >
        <circle cx={size / 2} cy={size / 2} r={raio} fill="none" strokeWidth={stroke} className="stroke-foreground/15" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={raio}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          className="stroke-primary transition-[stroke-dashoffset] duration-200 ease-out"
          strokeDasharray={circunferencia}
          strokeDashoffset={determinado ? circunferencia * (1 - valor / 100) : circunferencia * 0.72}
        />
      </svg>
      {determinado && (
        <span data-testid="upload-progress-percent" className="absolute inset-0 flex items-center justify-center font-bold tabular-nums text-foreground" style={{ fontSize: Math.round(size * 0.24) }}>
          {valor}%
        </span>
      )}
    </div>
  );
}
