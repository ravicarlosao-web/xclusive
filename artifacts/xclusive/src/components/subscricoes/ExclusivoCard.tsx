import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
    void queryClient.invalidateQueries({ queryKey: ['/api/users', username, 'posts'] });
    void queryClient.invalidateQueries({ queryKey: ['/api/feed'] });
  }

  const aCarregar = !mock && (aCarregarSubs || plano.isLoading);
  const p = plano.data;
  const rotuloSubscrever = mock
    ? 'Subscrever'
    : p?.tipoSubscricao === 'gratuita' ? 'Subscrever grátis' : p ? `Subscrever por ${kz(p.preco)} / mês` : 'Subscrever';

  return (
    <div className="text-center py-20 max-w-md mx-auto border border-primary/20 rounded-2xl bg-primary/5 p-8 relative overflow-hidden" data-testid="exclusivo-card">
      <div className="absolute top-0 right-0 w-32 h-32 bg-primary/20 rounded-full blur-3xl -mr-10 -mt-10" />
      <div className="absolute bottom-0 left-0 w-32 h-32 bg-primary/20 rounded-full blur-3xl -ml-10 -mb-10" />

      <div className="w-20 h-20 bg-background rounded-full flex items-center justify-center mx-auto mb-6 border border-primary/30 shadow-none dark:shadow-[0_0_20px_rgba(255,62,114,0.2)] relative">
        <Lock className="w-10 h-10 text-primary" />
      </div>
      <h3 className="text-2xl font-bold mb-2 relative">Clube Exclusivo</h3>
      <p className="text-muted-foreground mb-6 relative">
        Desbloqueia conteúdos privados, bastidores e interação direta com {nomeExibicao}.
      </p>

      <div className="relative space-y-3" data-testid="exclusivo-estado">
        {aCarregar && <p className="text-sm text-muted-foreground">A carregar…</p>}

        {/* Com acesso (ativa ou cancelada dentro do período) */}
        {!aCarregar && sub?.temAcesso && (
          <>
            <p className="font-semibold" data-testid="estado-texto">
              {sub.estado === 'cancelada'
                ? 'Subscrição cancelada'
                : sub.gratuita ? 'Subscrição gratuita ativa' : 'Subscrição ativa'}
            </p>
            <p className="text-sm text-muted-foreground" data-testid="estado-data">
              {sub.acessoAte
                ? <>{sub.estado === 'cancelada' ? 'Acesso até' : 'Válida até'} <strong className="text-foreground">{formatarData(sub.acessoAte)}</strong></>
                : 'Sem data de fim.'}
            </p>
            {sub.podeRenovar && (
              <Button className="w-full h-11 font-bold" onClick={() => setRenovarAberto(true)} data-testid="btn-renovar">
                {sub.estado === 'cancelada' ? 'Reativar' : 'Renovar'}{sub.preco != null ? ` · ${kz(sub.preco)}` : ''}
              </Button>
            )}
            {sub.estado === 'ativa' && (
              <Button variant="outline" className="w-full" onClick={() => setCancelarAberto(true)} data-testid="btn-cancelar">
                Cancelar subscrição
              </Button>
            )}
          </>
        )}

        {/* Terminou */}
        {!aCarregar && sub && !sub.temAcesso && (
          <>
            <p className="font-semibold" data-testid="estado-texto">Subscrição expirada</p>
            {sub.terminouEm && (
              <p className="text-sm text-muted-foreground" data-testid="estado-data">
                Terminou em <strong className="text-foreground">{formatarData(sub.terminouEm)}</strong>
              </p>
            )}
            {sub.podeRenovar ? (
              <Button className="w-full h-11 font-bold" onClick={() => setRenovarAberto(true)} data-testid="btn-renovar">
                Renovar{sub.preco != null ? ` · ${kz(sub.preco)}` : ''}
              </Button>
            ) : (
              <Button className="w-full h-12 font-bold shadow-none dark:shadow-[0_0_20px_rgba(255,62,114,0.3)]" onClick={() => setSubscreverAberto(true)} data-testid="btn-subscrever">
                {rotuloSubscrever}
              </Button>
            )}
          </>
        )}

        {/* Nunca subscreveu */}
        {!aCarregar && !sub && (
          plano.isError && !mock ? (
            <p className="text-sm text-muted-foreground" data-testid="plano-indisponivel">
              {(plano.error as Error)?.message || 'Esta criadora ainda não tem uma subscrição disponível.'}
            </p>
          ) : (
            <Button className="w-full h-12 font-bold shadow-none dark:shadow-[0_0_20px_rgba(255,62,114,0.3)]" onClick={() => setSubscreverAberto(true)} data-testid="btn-subscrever">
              {rotuloSubscrever}
            </Button>
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
