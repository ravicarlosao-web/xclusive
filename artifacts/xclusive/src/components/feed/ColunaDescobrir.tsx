import { Link } from 'wouter';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useColunaParada } from '@/hooks/useColunaParada';
import { useAjusteColuna } from '@/hooks/useAjusteColuna';
import { PesquisaFeed } from './PesquisaFeed';
import { BannerSugestoes } from './BannerSugestoes';
import { TopCriadores } from './TopCriadores';
import { SugestoesParaTi } from './SugestoesParaTi';

/**
 * Coluna direita de descoberta (lg+), partilhada pelo Início e por Explorar: pesquisa, SUGESTÕES/banner, Top Criadores,
 * Sugestões para ti e o botão. Parada (sticky, altura do ecrã), com o tamanho ajustado por medição (useAjusteColuna) e a roda
 * bloqueada sobre ela (useColunaParada). Mesmas chaves de cache nos blocos: sem pedidos novos nem intervalos.
 */
export function ColunaDescobrir({ semDados }: { semDados: boolean }) {
  const colunaRef = useColunaParada<HTMLElement>();
  const { cartoes } = useAjusteColuna(colunaRef);
  return (
    <aside ref={colunaRef} aria-label="Descobrir" className="coluna-direita hidden lg:flex flex-col lg:sticky lg:top-0 lg:h-[100dvh] lg:self-start w-[320px] xl:w-[400px] flex-shrink-0">
      <PesquisaFeed desativada={semDados} />
      <BannerSugestoes />
      <TopCriadores ativo={!semDados} />
      <SugestoesParaTi ativo={!semDados} porPagina={cartoes} />
      <Link href="/explorar" className="cd-descubra shrink-0">
        <Button className="h-[var(--cd-btn,48px)] w-full gap-2 rounded-xl bg-primary text-sm font-bold tracking-wide text-primary-foreground hover:bg-primary/90" data-testid="descubra-mais">DESCUBRA MAIS CRIADORES <ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
      </Link>
    </aside>
  );
}
