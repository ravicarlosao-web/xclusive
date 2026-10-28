import { Link } from 'wouter';
import { cn } from '@/lib/utils';
import { LEGAL_PAGES, useLegalConfig } from '@/pages/legal/useLegalDocs';
import type { LegalConfig } from '@/pages/legal/resolver';

/**
 * Rodapé legal: texto curto da empresa + links dos 5 documentos.
 * O nome da empresa e o email vêm do legal-config (nunca escritos à mão). Se o legal-config estiver a carregar ou
 * falhar, mostra só os links (sem texto da empresa, sem buracos) e nunca bloqueia a página.
 * `config`: quando quem o usa já tem o legal-config (páginas legais), evita um segundo pedido.
 * `soLinks`: só os links (AgeGate).
 */
export function RodapeLegal({ config, soLinks = false, className }: { config?: LegalConfig | null; soLinks?: boolean; className?: string }) {
  const proprio = useLegalConfig(!soLinks && config === undefined);
  const cfg = config ?? proprio.config;
  const empresa = !soLinks && cfg ? cfg : null;

  return (
    <footer
      data-testid="rodape-legal"
      className={cn('w-full border-t border-border pt-4 pb-2 text-center text-xs text-muted-foreground', className)}
    >
      {empresa && (
        <p className="mb-2 break-words" data-testid="rodape-legal-texto">
          Xclusive é uma rede social de conteúdo privado para maiores de 18 anos, operada por {empresa.empresaNome}. Contacto:{' '}
          <a href={`mailto:${empresa.emailLegal}`} className="inline-flex items-center min-h-[44px] lg:min-h-0 break-all hover:text-primary hover:underline">{empresa.emailLegal}</a>.
        </p>
      )}
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
