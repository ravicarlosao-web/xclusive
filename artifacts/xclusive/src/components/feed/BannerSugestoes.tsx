import { useState } from 'react';
import { Link } from 'wouter';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const BANNERS = [
  { id: 'subscrever', titulo: 'Subscreve os teus criadores favoritos e acede a conteúdo exclusivo.', subtexto: 'Fotos, vídeos e lives só para quem apoia.', href: '/explorar' },
];

/**
 * "SUGESTÕES" com setas ‹ › e o banner rosa (logo + texto), que leva a /explorar. Há um só banner: as setas ficam
 * VISÍVEIS mas desativadas (aria-disabled); com mais banners alternam entre eles.
 */
export function BannerSugestoes() {
  const [i, setI] = useState(0);
  const n = BANNERS.length;
  const b = BANNERS[i];
  const mudar = (d: number) => setI((x) => (x + d + n) % n);
  const sem = n <= 1;
  return (
    <section aria-label="Sugestões" className="cd-banner mb-[var(--cd-gap-b,24px)] shrink-0" data-testid="banner-sugestoes">
      <div className="mb-[var(--cd-hmb2,8px)] flex items-center justify-between">
        <h2 className="text-sm font-extrabold uppercase tracking-wide text-foreground">Sugestões</h2>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Banner anterior" disabled={sem} onClick={() => mudar(-1)} data-testid="banner-anterior"
            className="flex h-[var(--cd-seta,32px)] w-[var(--cd-seta,32px)] items-center justify-center rounded-full text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:text-muted-foreground disabled:opacity-60">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" aria-label="Banner seguinte" disabled={sem} onClick={() => mudar(1)} data-testid="banner-seguinte"
            className="flex h-[var(--cd-seta,32px)] w-[var(--cd-seta,32px)] items-center justify-center rounded-full text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:text-muted-foreground disabled:opacity-60">
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      <Link href={b.href} data-testid="banner-link"
        className="flex flex-col items-center rounded-2xl bg-gradient-to-br from-primary/25 via-primary/15 to-primary/5 px-5 py-[var(--cd-ban-py,24px)] text-center transition-opacity hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <img src="/logo.png" alt="Xclusive" className="mb-[var(--cd-ban-mb,12px)] hidden h-[var(--cd-ban-logo,40px)] w-auto dark:block" />
        <img src="/logo-claro.png" alt="Xclusive" className="mb-[var(--cd-ban-mb,12px)] h-[var(--cd-ban-logo,40px)] w-auto dark:hidden" />
        <p className="text-[length:var(--cd-ban-txt,14px)] font-bold leading-snug text-foreground">{b.titulo}</p>
        <p className="mt-1 text-[length:var(--cd-ban-sub,12px)] leading-[1.35] text-foreground">{b.subtexto}</p>
      </Link>
    </section>
  );
}
