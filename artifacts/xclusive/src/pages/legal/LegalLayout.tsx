import { Link } from 'wouter';
import { useEffect, type ReactNode } from 'react';
import { LEGAL_PAGES, useLegalDocs, type LegalDocKey } from './useLegalDocs';

/**
 * Estrutura comum das páginas legais (públicas, sem login). NÃO contém texto jurídico:
 * o conteúdo é um placeholder visível até o texto ser redigido com o advogado.
 * A versão e a data vêm do servidor (lib: LEGAL_DOCS em routes/auth.ts).
 */
export function LegalLayout({ docKey, children }: { docKey: LegalDocKey; children?: ReactNode }) {
  const docs = useLegalDocs();
  const page = LEGAL_PAGES.find((p) => p.key === docKey)!;
  const info = docs?.[docKey];

  useEffect(() => {
    const anterior = document.title;
    document.title = `${page.titulo} — Xclusive`;
    return () => { document.title = anterior; };
  }, [page.titulo]);

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="border-b border-border/50">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/"><img src="/logo.png" alt="Xclusive" className="h-6 w-auto cursor-pointer" /></Link>
          <Link href="/" className="text-sm text-muted-foreground hover:text-primary transition-colors">Voltar ao início</Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-10">
        <h1 className="text-3xl font-bold tracking-tight mb-2" data-testid="legal-title">{page.titulo}</h1>
        <p className="text-sm text-muted-foreground mb-8" data-testid="legal-version">
          {info ? <>Versão {info.versao} · Atualizado em {new Date(info.atualizadoEm).toLocaleDateString('pt-PT')}</> : 'Versão indisponível'}
        </p>

        {children ?? (
          <div className="rounded-xl border border-dashed border-yellow-500/50 bg-yellow-500/5 p-6 text-sm" data-testid="legal-placeholder">
            <p className="font-semibold text-yellow-500 mb-1">Texto em preparação</p>
            <p className="text-muted-foreground">
              Este documento ainda não está em vigor. O texto jurídico definitivo será publicado aqui.
            </p>
          </div>
        )}

        <nav aria-label="Outros documentos legais" className="mt-12 pt-6 border-t border-border/50 flex flex-wrap gap-x-6 gap-y-2">
          {LEGAL_PAGES.filter((p) => p.key !== docKey).map((p) => (
            <Link key={p.key} href={p.path} className="text-sm text-muted-foreground hover:text-primary transition-colors">{p.titulo}</Link>
          ))}
        </nav>
      </main>
    </div>
  );
}
