import { Link } from 'wouter';
import { useEffect, useMemo, type ReactNode } from 'react';
import { LEGAL_PAGES, useLegalConfig, type LegalDocKey } from './useLegalDocs';
import { RodapeLegal } from '@/components/shared/RodapeLegal';
import { DOCUMENTOS_LEGAIS } from './conteudo';
import { LegalDocumento } from './LegalDocumento';
import { textoResolvido } from './resolver';

/**
 * Estrutura comum das páginas legais (públicas, sem login). O texto vem dos documentos do advogado (v1.1), em JSON
 * gerado dos .docx; os dados variáveis (empresa, email, mínimo e prazos de levantamento) vêm de GET /api/auth/legal-config.
 * Se esses dados falharem, mostra um erro claro e NUNCA o texto com buracos.
 */
export function LegalLayout({ docKey, marcas }: { docKey: LegalDocKey; marcas?: { emailTestId?: string; paragrafoComEmailTestId?: string }; children?: ReactNode }) {
  const { config, erro, tentarOutraVez } = useLegalConfig();
  const doc = DOCUMENTOS_LEGAIS[docKey];
  const titulo = useMemo(() => {
    const b = doc.blocos.find((x) => x.tipo === 'titulo');
    return b && b.tipo !== 'tabela' ? b.runs.map((r) => r.t).join('') : LEGAL_PAGES.find((p) => p.key === docKey)!.titulo;
  }, [doc, docKey]);
  // Antes de resolver os tokens, valida que o documento resolve por completo (senão mostra o erro em vez do texto).
  const conteudo = useMemo(() => {
    if (!config) return null;
    try { doc.blocos.forEach((b) => { if (b.tipo !== 'tabela') b.runs.forEach((r) => textoResolvido(r.t, config)); }); return <LegalDocumento doc={doc} cfg={config} marcas={marcas} />; } catch { return 'erro' as const; }
  }, [config, doc, marcas]);

  useEffect(() => {
    const anterior = document.title;
    document.title = `${titulo} — Xclusive`;
    return () => { document.title = anterior; };
  }, [titulo]);

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="border-b border-border/50">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/login">
            {/* Dois logos trocados por tema (ver AuthSplitLayout) */}
            <img src="/logo.png" alt="Xclusive" className="hidden dark:block h-6 w-auto cursor-pointer" />
            <img src="/logo-claro.png" alt="Xclusive" className="dark:hidden h-6 w-auto cursor-pointer" />
          </Link>
          <Link href="/login" className="text-sm text-muted-foreground hover:text-primary transition-colors">Voltar</Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-10">
        {conteudo && conteudo !== 'erro' ? conteudo : erro || conteudo === 'erro' ? (
          <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-sm" data-testid="legal-erro">
            <p className="font-semibold text-destructive mb-1">Não foi possível carregar este documento</p>
            <p className="text-muted-foreground mb-4">Tenta novamente daqui a pouco. Se o problema continuar, contacta-nos.</p>
            <button type="button" onClick={tentarOutraVez} className="rounded-lg border border-border px-4 py-2 font-medium hover:bg-secondary transition-colors">Tentar novamente</button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="legal-a-carregar" aria-busy="true">A carregar…</p>
        )}

      </main>

      <RodapeLegal config={config} className="max-w-3xl mx-auto px-4 mt-4 pb-8" />
    </div>
  );
}
