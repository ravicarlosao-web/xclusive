import { Link } from 'wouter';
import { cn } from '@/lib/utils';
import { LEGAL_PAGES } from '@/pages/legal/useLegalDocs';

/** Rodapé legal: só os links dos documentos legais. */
export function RodapeLegal({ className }: { className?: string }) {
  return (
    <footer
      data-testid="rodape-legal"
      className={cn('w-full border-t border-border pt-4 pb-2 text-center text-xs text-muted-foreground', className)}
    >
      <nav aria-label="Documentos legais" className="flex flex-wrap justify-center gap-x-5">
        {LEGAL_PAGES.map((p) => (
          <Link key={p.key} href={p.path} className="inline-flex items-center min-h-[44px] lg:min-h-[32px] hover:text-primary hover:underline transition-colors">
            {p.curto}
          </Link>
        ))}
      </nav>
    </footer>
  );
}
