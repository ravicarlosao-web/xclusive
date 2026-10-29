import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { SubscribeModal } from '@/components/wallet/SubscribeModal';
import { RenovarDialog, CancelarDialog } from '@/components/subscricoes/AcoesSubscricao';
import { useMinhasSubscricoes } from '@/hooks/useMinhasSubscricoes';
import { MINHAS_SUBS_KEY, ehSessaoMock, fetchPlanoCriador, formatarData, kz } from '@/lib/subscricoes';

interface ExclusivoCardProps {
  username: string;
  nomeExibicao: string;
  avatarUrl: string | null;
  verificado: boolean;
}

/**
 * Aba "Exclusivo" do perfil de uma criadora (nunca é mostrada no próprio perfil). Estado, preço, plano e
 * datas vêm do servidor: GET /subscriptions/me (a minha subscrição) e GET /users/:u/subscription-plan.
 */
export function ExclusivoCard({ username, nomeExibicao, avatarUrl, verificado }: ExclusivoCardProps) {
  const queryClient = useQueryClient();
  const { porUsername, isLoading: aCarregarSubs } = useMinhasSubscricoes();
  const mock = ehSessaoMock();
  const sub = porUsername.get(username) ?? null;

  const plano = useQuery({
    queryKey: ['/api/users', username, 'subscription-plan'],
    queryFn: () => fetchPlanoCriador(username),
    enabled: !mock,
    retry: false,
    staleTime: 15_000,
  });

  const [subscreverAberto, setSubscreverAberto] = useState(false);
  const [renovarAberto, setRenovarAberto] = useState(false);
  const [cancelarAberto, setCancelarAberto] = useState(false);

  function atualizar() {
    void queryClient.invalidateQueries({ queryKey: MINHAS_SUBS_KEY });
    void queryClient.invalidateQueries({ queryKey: ['/api/users', username, 'subscription-plan'] });
    void queryClient.invalidateQueries({ queryKey: [`/api/users/${username}/posts`] });
    void queryClient.invalidateQueries({ queryKey: ['/api/feed'] });
  }

  const aCarregar = !mock && (aCarregarSubs || plano.isLoading);
  const p = plano.data;

  const precoTxt = (n: number | null | undefined) => (n != null ? `${kz(n)} / mês` : '');
  const direitaPlano = mock ? '' : p?.tipoSubscricao === 'gratuita' ? 'GRATUITO' : p ? precoTxt(p.preco) : '';

  // Uma linha em pílula: à esquerda o estado/ação, à direita o preço ou GRATUITO. Com `onClick` é um botão; sem ele, só estado.
  const pilula = (rotulo: string, direita: string, o: { onClick?: () => void; testid?: string } = {}) => {
    const cls = 'flex min-h-[44px] w-full items-center justify-between gap-3 rounded-full border border-border px-5 text-sm font-bold uppercase tracking-wide text-primary';
    const conteudo = (<><span>{rotulo}</span>{direita && <span className="text-right">{direita}</span>}</>);
    return o.onClick
      ? <button type="button" onClick={o.onClick} className={cn(cls, 'transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none')} data-testid={o.testid}>{conteudo}</button>
      : <div className={cls} data-testid={o.testid ?? 'pilula-estado'}>{conteudo}</div>;
  };
  const ligacao = 'min-h-[44px] self-start text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded';

  return (
    <div className="flex flex-col gap-1" data-testid="exclusivo-card">
      <div className="flex flex-col gap-1" data-testid="exclusivo-estado">
        {aCarregar && <div className="flex min-h-[44px] items-center rounded-full border border-border px-5 text-sm text-muted-foreground">A carregar…</div>}

        {/* Com acesso (ativa ou cancelada dentro do período) */}
        {!aCarregar && sub?.temAcesso && (
          <>
            {sub.estado === 'cancelada' && sub.podeRenovar
              ? pilula('Reativar', sub.preco != null ? precoTxt(sub.preco) : '', { onClick: () => setRenovarAberto(true), testid: 'btn-renovar' })
              : pilula('Já sou assinante', sub.gratuita ? 'GRATUITO' : precoTxt(sub.preco))}
            <p className="px-1 text-xs text-muted-foreground" data-testid="estado-texto">
              {sub.estado === 'cancelada' ? 'Subscrição cancelada' : sub.gratuita ? 'Subscrição gratuita ativa' : 'Subscrição ativa'}
            </p>
            <p className="px-1 text-xs text-muted-foreground" data-testid="estado-data">
              {sub.acessoAte
                ? <>{sub.estado === 'cancelada' ? 'Acesso até' : 'Válida até'} <strong className="text-foreground">{formatarData(sub.acessoAte)}</strong></>
                : 'Sem data de fim.'}
            </p>
            {sub.podeRenovar && sub.estado !== 'cancelada' && (
              <button type="button" className={ligacao} onClick={() => setRenovarAberto(true)} data-testid="btn-renovar">
                Renovar{sub.preco != null ? ` · ${kz(sub.preco)}` : ''}
              </button>
            )}
            {sub.estado === 'ativa' && (
              <button type="button" className={ligacao} onClick={() => setCancelarAberto(true)} data-testid="btn-cancelar">Cancelar subscrição</button>
            )}
          </>
        )}

        {/* Terminou */}
        {!aCarregar && sub && !sub.temAcesso && (
          <>
            {sub.podeRenovar
              ? pilula('Renovar', sub.preco != null ? precoTxt(sub.preco) : '', { onClick: () => setRenovarAberto(true), testid: 'btn-renovar' })
              : pilula('Subscrever', direitaPlano, { onClick: () => setSubscreverAberto(true), testid: 'btn-subscrever' })}
            <p className="px-1 text-xs text-muted-foreground" data-testid="estado-texto">Subscrição expirada</p>
            {sub.terminouEm && (
              <p className="px-1 text-xs text-muted-foreground" data-testid="estado-data">
                Terminou em <strong className="text-foreground">{formatarData(sub.terminouEm)}</strong>
              </p>
            )}
          </>
        )}

        {/* Nunca subscreveu */}
        {!aCarregar && !sub && (
          plano.isError && !mock ? (
            <p className="px-1 text-sm text-muted-foreground" data-testid="plano-indisponivel">
              {(plano.error as Error)?.message || 'Esta criadora ainda não tem uma subscrição disponível.'}
            </p>
          ) : (
            pilula('Subscrever', direitaPlano, { onClick: () => setSubscreverAberto(true), testid: 'btn-subscrever' })
          )
        )}
      </div>

      <SubscribeModal
        open={subscreverAberto}
        onClose={() => setSubscreverAberto(false)}
        creatorUsername={username}
        creatorNome={nomeExibicao}
        creatorAvatar={avatarUrl}
        creatorVerificado={verificado}
        onSubscribed={atualizar}
      />
      <RenovarDialog sub={sub} open={renovarAberto} onClose={() => { setRenovarAberto(false); atualizar(); }} />
      <CancelarDialog sub={sub} open={cancelarAberto} onClose={() => { setCancelarAberto(false); atualizar(); }} />
    </div>
  );
}
