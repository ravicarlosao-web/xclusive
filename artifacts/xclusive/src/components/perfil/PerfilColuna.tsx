import { Search, X } from 'lucide-react';
import type { Post } from '@workspace/api-client-react';

/** Só entra na coluna o que o visitante já pode ver, sem placeholders: imagem gratuita, com URL, não bloqueada. */
export function miniaturasElegiveis(posts: Post[], max = 3): Post[] {
  return posts.filter((p) => !p.exclusivo && !p.bloqueado && p.media?.[0]?.tipo === 'imagem' && !!p.media[0].url).slice(0, max);
}

/**
 * Coluna direita do perfil (só desktop): pesquisa no cliente nas publicações JÁ carregadas e bloco RECENTE (até 3 miniaturas
 * elegíveis, a partir da mesma lista; sem pedidos extra). O bloco esconde-se se não houver nenhuma elegível.
 */
export function PerfilColuna({ pesquisa, onPesquisa, publicacoes, onAbrir, onImagemFalhou }: {
  pesquisa: string; onPesquisa: (v: string) => void; publicacoes: Post[]; onAbrir: (p: Post) => void; onImagemFalhou: (id: number) => void;
}) {
  const miniaturas = miniaturasElegiveis(publicacoes);
  return (
    <>
      <div className="relative mb-[var(--cd-gap,20px)] shrink-0" data-testid="perfil-pesquisa">
        <div className="flex h-[var(--cd-pesq,44px)] items-center gap-2 rounded-xl border border-border bg-secondary px-4 focus-within:ring-2 focus-within:ring-ring">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input type="search" value={pesquisa} onChange={(e) => onPesquisa(e.target.value)} placeholder="Pesquisar publicações do utilizador"
            aria-label="Pesquisar publicações do utilizador" autoComplete="off" data-testid="perfil-pesquisa-input"
            className="h-full w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" />
          {pesquisa && <button type="button" onClick={() => onPesquisa('')} aria-label="Limpar pesquisa" className="-mr-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="perfil-pesquisa-limpar"><X className="h-4 w-4" aria-hidden="true" /></button>}
        </div>
      </div>

      {miniaturas.length > 0 && (
        <section aria-labelledby="perfil-recente-titulo" className="cd-recente mb-[var(--cd-gap,24px)] shrink-0 rounded-xl border border-border p-3" data-testid="perfil-recente">
          <h2 id="perfil-recente-titulo" className="mb-2 text-xs font-extrabold uppercase tracking-wide text-foreground">Recente</h2>
          <ul className="grid grid-cols-3 gap-2">
            {miniaturas.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => onAbrir(p)} aria-label={`Abrir publicação${p.legenda ? `: ${p.legenda.slice(0, 60)}` : ''}`} data-testid="perfil-miniatura"
                  className="block h-[var(--cd-thumb,117px)] min-h-[44px] w-full overflow-hidden rounded-md bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <img src={p.media?.[0]?.url ?? ''} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => onImagemFalhou(p.id)} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
