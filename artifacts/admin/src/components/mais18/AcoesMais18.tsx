import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';

/** Regra: a N-ésima infração ativa a partir da 3.ª suspende a conta (igual ao servidor). */
export const LIMITE_SUSPENSAO = 3;

export type TipoMais18 = 'post' | 'story' | 'live';
export const TIPOS_MAIS18: string[] = ['post', 'story', 'live'];
const ROTULO: Record<TipoMais18, string> = { post: 'publicação', story: 'story', live: 'live' };

export function SeloMais18({ className = '' }: { className?: string }) {
  return (
    <span data-testid="selo-mais18" title="Conteúdo +18"
      className={`inline-flex items-center rounded-md bg-red-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white ${className}`}>
      +18
    </span>
  );
}

type Modo = null | 'infracao' | 'correcao' | 'desmarcar';

/** Infrações ativas da criadora e o que aconteceria à próxima (lido só quando `enabled`; sem cache). */
export function useResumoInfracao(donoId: number | null | undefined, enabled: boolean) {
  const infr = useQuery({
    queryKey: ['infracoes-mais18', donoId],
    queryFn: () => adminApi.getInfracoesMais18(donoId as number),
    enabled: enabled && !!donoId,
    staleTime: 0,
    gcTime: 0,
  });
  const ativas: number | null = infr.data ? infr.data.ativas : null;
  const seraN = ativas === null ? null : ativas + 1;
  const suspende = seraN !== null && seraN >= LIMITE_SUSPENSAO;
  return { infr, ativas, seraN, suspende };
}

/** Contagem, "esta será a X.ª" e aviso de suspensão (3.ª e seguintes) — partilhado pelos diálogos de confirmação. */
export function ResumoInfracaoMais18({ donoId, resumo }: { donoId: number | null | undefined; resumo: ReturnType<typeof useResumoInfracao> }) {
  const { infr, ativas, seraN, suspende } = resumo;
  if (!donoId) return <p className="text-muted-foreground">Não foi possível identificar a criadora.</p>;
  if (infr.isLoading) return <p className="text-muted-foreground">A ler as infrações da criadora…</p>;
  if (infr.error) return <p className="text-red-400" data-testid="infracao-erro">{String((infr.error as Error).message)}</p>;
  return (
    <div className="rounded-lg border p-3 space-y-1" data-testid="infracao-resumo">
      <p>A criadora tem <strong data-testid="infracoes-ativas">{ativas}</strong> infração(ões) ativa(s) de {LIMITE_SUSPENSAO}.</p>
      <p>Esta será a <strong data-testid="infracao-seria">{seraN}.ª</strong> infração.</p>
      {suspende ? (
        <p className="font-semibold text-red-400" data-testid="aviso-suspensao">
          Atenção: a {LIMITE_SUSPENSAO}.ª infração (e as seguintes) SUSPENDE a conta e revoga as sessões. Só um admin a pode reativar.
        </p>
      ) : (
        <p className="text-muted-foreground" data-testid="aviso-normal">
          {seraN === LIMITE_SUSPENSAO - 1 ? 'Será o 2.º aviso: ' : 'Será um aviso: '}a {LIMITE_SUSPENSAO}.ª infração suspende a conta.
        </p>
      )}
    </div>
  );
}

/**
 * Ações do admin sobre a marcação +18 de um conteúdo (post, story, live):
 *  - "Marcar +18 (criadora não marcou, regista infração)": confirma mostrando as infrações ativas da criadora;
 *  - "Marcar +18 (correção minha, sem infração)": só marca, sem infração nem aviso;
 *  - "Desmarcar": se existir infração ativa neste conteúdo, oferece anulá-la.
 * Os erros do servidor (409 etc.) aparecem com a mensagem do servidor.
 */
export function AcoesMais18({ tipo, id, donoId, mais18: inicial, onChange }: {
  tipo: TipoMais18; id: number; donoId: number | null | undefined; mais18: boolean; onChange?: (mais18: boolean) => void;
}) {
  const [mais18, setMais18] = useState(inicial);
  useEffect(() => { setMais18(inicial); }, [inicial]);
  const [modo, setModo] = useState<Modo>(null);
  const [motivo, setMotivo] = useState('');
  const [anular, setAnular] = useState<{ infracaoId: number } | null>(null);
  const [motivoAnulacao, setMotivoAnulacao] = useState('');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Infrações da criadora: só lidas quando se abre a confirmação de "regista infração"
  const resumo = useResumoInfracao(donoId, modo === 'infracao');
  const { infr, suspende } = resumo;

  const fechar = () => { setModo(null); setMotivo(''); };
  const falha = (e: any) => toast({ title: 'Não foi possível concluir', description: String(e?.message ?? '').slice(0, 300), variant: 'destructive' });
  const refrescar = () => {
    queryClient.invalidateQueries({ queryKey: ['infracoes-mais18'] });
    queryClient.invalidateQueries({ queryKey: ['posts'] });
  };

  const marcar = useMutation({
    mutationFn: (infracao: boolean) => adminApi.marcarMais18(tipo, id, { mais18: true, infracao, motivo: motivo.trim() || undefined }),
    onSuccess: (r: any) => {
      setMais18(true); onChange?.(true); fechar(); refrescar();
      if (r.infracao) {
        toast({
          title: r.suspendeu ? `Infração ${r.infracao.numero}: conta suspensa` : `Infração ${r.infracao.numero}: aviso enviado`,
          description: r.suspendeu ? 'A conta da criadora foi suspensa e as sessões revogadas.' : 'A criadora recebeu um aviso.',
        });
      } else if (!r.mudou) {
        toast({ title: 'Já estava marcado como +18', description: 'Nada foi alterado e não foi registada nenhuma infração.' });
      } else {
        toast({ title: 'Marcado como +18 (correção)', description: 'Sem infração e sem aviso à criadora.' });
      }
    },
    onError: (e) => { fechar(); falha(e); },
  });

  const desmarcar = useMutation({
    mutationFn: () => adminApi.marcarMais18(tipo, id, { mais18: false, motivo: motivo.trim() || undefined }),
    onSuccess: (r: any) => {
      setMais18(false); onChange?.(false); fechar(); refrescar();
      toast({ title: r.mudou ? 'Marca +18 removida' : 'Já estava sem marca +18' });
      if (r.infracaoAtivaId) setAnular({ infracaoId: r.infracaoAtivaId });
    },
    onError: (e) => { fechar(); falha(e); },
  });

  const anularMut = useMutation({
    mutationFn: () => adminApi.anularInfracaoMais18(anular!.infracaoId, motivoAnulacao.trim()),
    onSuccess: (r: any) => {
      toast({ title: 'Infração anulada', description: `A criadora tem agora ${r.ativas} infração(ões) ativa(s).` });
      setAnular(null); setMotivoAnulacao(''); refrescar();
    },
    onError: (e) => falha(e),
  });

  const rot = ROTULO[tipo];
  return (
    <div className="space-y-2" data-testid="acoes-mais18">
      <div className="flex items-center gap-2">
        {mais18 && <SeloMais18 />}
        <span className="text-[11px] text-muted-foreground">{mais18 ? 'Marcado como +18' : 'Sem marca +18'}</span>
      </div>
      {!mais18 ? (
        <div className="flex flex-col gap-1.5">
          <Button size="sm" variant="outline" className="h-auto whitespace-normal py-1.5 text-left text-xs border-red-500/40 text-red-400 hover:text-red-300"
            data-testid="mais18-marcar-infracao" onClick={() => setModo('infracao')}>
            Marcar +18 (criadora não marcou, regista infração)
          </Button>
          <Button size="sm" variant="outline" className="h-auto whitespace-normal py-1.5 text-left text-xs"
            data-testid="mais18-marcar-correcao" onClick={() => setModo('correcao')}>
            Marcar +18 (correção minha, sem infração)
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" className="h-auto py-1.5 text-xs" data-testid="mais18-desmarcar" onClick={() => setModo('desmarcar')}>
          Desmarcar
        </Button>
      )}

      {/* Confirmação: marcar com infração */}
      <Dialog open={modo === 'infracao'} onOpenChange={(o) => { if (!o && !marcar.isPending) fechar(); }}>
        <DialogContent className="sm:max-w-[480px]" data-testid="dialogo-infracao">
          <DialogHeader>
            <DialogTitle>Marcar {rot} como +18 e registar infração</DialogTitle>
            <DialogDescription>A criadora não marcou este conteúdo. Fica registada uma infração e ela recebe um aviso.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <ResumoInfracaoMais18 donoId={donoId} resumo={resumo} />
            <textarea className="w-full rounded-md border bg-background px-3 py-2 min-h-[60px]" placeholder="Motivo (opcional, fica no registo; a criadora não o vê)"
              maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} data-testid="motivo-marcar" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={fechar} disabled={marcar.isPending}>Cancelar</Button>
            <Button variant={suspende ? 'destructive' : 'default'} disabled={marcar.isPending || infr.isLoading || !!infr.error || !donoId}
              data-testid="confirmar-infracao" onClick={() => marcar.mutate(true)}>
              {suspende ? 'Marcar, registar infração e suspender' : 'Marcar e registar infração'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmação: correção (sem infração) */}
      <Dialog open={modo === 'correcao'} onOpenChange={(o) => { if (!o && !marcar.isPending) fechar(); }}>
        <DialogContent className="sm:max-w-[440px]" data-testid="dialogo-correcao">
          <DialogHeader>
            <DialogTitle>Marcar {rot} como +18 (correção)</DialogTitle>
            <DialogDescription>Só altera a marca. Não regista infração e a criadora não é avisada.</DialogDescription>
          </DialogHeader>
          <textarea className="w-full rounded-md border bg-background px-3 py-2 min-h-[60px] text-sm" placeholder="Motivo (opcional)"
            maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <DialogFooter>
            <Button variant="ghost" onClick={fechar} disabled={marcar.isPending}>Cancelar</Button>
            <Button disabled={marcar.isPending} data-testid="confirmar-correcao" onClick={() => marcar.mutate(false)}>Marcar sem infração</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmação: desmarcar */}
      <Dialog open={modo === 'desmarcar'} onOpenChange={(o) => { if (!o && !desmarcar.isPending) fechar(); }}>
        <DialogContent className="sm:max-w-[440px]" data-testid="dialogo-desmarcar">
          <DialogHeader>
            <DialogTitle>Desmarcar {rot}</DialogTitle>
            <DialogDescription>Remove a marca +18. Se houver uma infração ativa neste conteúdo, poderás anulá-la a seguir.</DialogDescription>
          </DialogHeader>
          <textarea className="w-full rounded-md border bg-background px-3 py-2 min-h-[60px] text-sm" placeholder="Motivo (opcional)"
            maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <DialogFooter>
            <Button variant="ghost" onClick={fechar} disabled={desmarcar.isPending}>Cancelar</Button>
            <Button disabled={desmarcar.isPending} data-testid="confirmar-desmarcar" onClick={() => desmarcar.mutate()}>Desmarcar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Depois de desmarcar: oferece anular a infração ativa deste conteúdo */}
      <Dialog open={!!anular} onOpenChange={(o) => { if (!o && !anularMut.isPending) { setAnular(null); setMotivoAnulacao(''); } }}>
        <DialogContent className="sm:max-w-[460px]" data-testid="dialogo-anular-apos-desmarcar">
          <DialogHeader>
            <DialogTitle>Este conteúdo tem uma infração ativa</DialogTitle>
            <DialogDescription>
              Infração #<span data-testid="infracao-ativa-id">{anular?.infracaoId}</span>. Desmarcar não a anula: continua a contar para as sanções da criadora, e ela continua sem poder desmarcar este conteúdo.
              Queres anulá-la?
            </DialogDescription>
          </DialogHeader>
          <textarea className="w-full rounded-md border bg-background px-3 py-2 min-h-[60px] text-sm" placeholder="Motivo da anulação (obrigatório)"
            maxLength={300} value={motivoAnulacao} onChange={(e) => setMotivoAnulacao(e.target.value)} data-testid="motivo-anular-apos" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setAnular(null); setMotivoAnulacao(''); }} disabled={anularMut.isPending} data-testid="manter-infracao">Manter a infração</Button>
            <Button variant="destructive" disabled={anularMut.isPending || !motivoAnulacao.trim()} data-testid="anular-apos-desmarcar" onClick={() => anularMut.mutate()}>Anular a infração</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
