import { useCallback, useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { getPost, useFollowUser, useVotarEnquete, type Post } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import { terminaEmTexto } from '@/lib/tempoRelativo';
import { cn } from '@/lib/utils';

type Enquete = NonNullable<Post['enquete']>;

/** O texto das opções vem de outras pessoas: é SEMPRE renderizado como texto simples (nunca como HTML). */
const votos = (n: number) => `${n.toLocaleString('pt-PT')} ${n === 1 ? 'voto' : 'votos'}`;

/**
 * Corpo de uma enquete no PostCard. Antes de votar só mostra as opções (botões de 44 px) e o total de votos; depois de votar,
 * para o autor e quando termina, mostra a percentagem por opção (barra e texto) e marca a escolhida. "Só seguidores" mostra
 * a ação de seguir. O fim é tratado com UM só setTimeout (limpo ao desmontar): ao chegar a hora mostra "Encerrada" e faz UM
 * pedido a este post para trazer os resultados completos. Sem polling.
 */
export function EnqueteCorpo({ post }: { post: Post }) {
  const { toast } = useToast();
  const [enquete, setEnquete] = useState<Enquete | undefined>(post.enquete);
  const [aVotar, setAVotar] = useState(false);
  const [seguirEnviado, setSeguirEnviado] = useState(false);
  const votar = useVotarEnquete();
  const seguir = useFollowUser();
  const refetchFeito = useRef(false);

  // Dados novos do servidor (ex.: o feed refez o pedido) substituem o estado local.
  useEffect(() => { setEnquete(post.enquete); }, [post.enquete]);

  const refrescar = useCallback(async () => {
    try {
      const novo = await getPost(post.id);
      if (novo.enquete) setEnquete(novo.enquete);
    } catch { /* a enquete mantém o estado atual; o próximo carregamento corrige */ }
  }, [post.id]);

  const terminaEm = enquete?.terminaEm;
  const jaEncerradaNoServidor = enquete?.encerrada ?? true;
  useEffect(() => {
    if (!terminaEm || jaEncerradaNoServidor) return;
    const falta = new Date(terminaEm).getTime() - Date.now();
    const disparar = () => {
      setEnquete((e) => (e ? { ...e, encerrada: true, podeVotar: false, motivo: e.motivo ?? 'encerrada' } : e));
      if (!refetchFeito.current) { refetchFeito.current = true; void refrescar(); }
    };
    if (falta <= 0) { disparar(); return; }
    const t = setTimeout(disparar, Math.min(falta + 250, 2_000_000_000));
    return () => clearTimeout(t);
  }, [terminaEm, jaEncerradaNoServidor, refrescar]);

  if (!enquete) return null;
  const mostraResultados = enquete.encerrada || enquete.meuVoto !== null || enquete.motivo === 'autor';

  async function aoVotar(opcaoId: number) {
    if (aVotar || !enquete?.podeVotar) return;
    setAVotar(true);
    try {
      setEnquete(await votar.mutateAsync({ id: post.id, data: { opcaoId } }));
    } catch (err) {
      const d = (err as { data?: { error?: string } } | null)?.data;
      toast({ variant: 'destructive', title: d?.error ?? 'Não foi possível registar o voto. Tenta novamente.' });
      void refrescar();
    } finally {
      setAVotar(false);
    }
  }

  async function aoSeguir() {
    try {
      await seguir.mutateAsync({ username: post.autor.username });
      setSeguirEnviado(true);
      await refrescar();
    } catch {
      toast({ variant: 'destructive', title: 'Não foi possível seguir. Tenta novamente.' });
    }
  }

  const estado = enquete.encerrada ? 'Encerrada' : terminaEmTexto(enquete.terminaEm);

  return (
    <div className="px-3 pb-2 sm:px-4" data-testid="enquete" data-encerrada={enquete.encerrada}>
      {mostraResultados ? (
        <ul className="flex flex-col gap-2" aria-label="Resultados da enquete" data-testid="enquete-resultados">
          {enquete.opcoes.map((o) => {
            const escolhida = enquete.meuVoto === o.id;
            const pct = o.percentagem ?? 0;
            return (
              <li key={o.id} data-testid="enquete-opcao" data-escolhida={escolhida}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                  <span className={cn('flex min-w-0 items-center gap-1.5 break-words', escolhida && 'font-bold')}>
                    {escolhida && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
                    <span>{o.texto}</span>
                    {escolhida && <span className="sr-only"> (a tua escolha)</span>}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums" data-testid="enquete-percentagem">{pct}%</span>
                </div>
                <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
                  aria-label={`${o.texto}: ${pct}%, ${votos(o.votos ?? 0)}${escolhida ? ', a tua escolha' : ''}`}
                  className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                  <div className={cn('h-full rounded-full', escolhida ? 'bg-primary' : 'bg-muted-foreground/40')} style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div role="group" aria-label="Opções da enquete" className="flex flex-col gap-2" data-testid="enquete-opcoes">
          {enquete.opcoes.map((o) => (
            <button key={o.id} type="button" disabled={!enquete.podeVotar || aVotar} onClick={() => { void aoVotar(o.id); }} data-testid="enquete-opcao"
              className="min-h-[44px] w-full break-words rounded-xl border border-border px-4 py-2 text-left text-sm font-medium transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-70 disabled:hover:bg-transparent motion-reduce:transition-none">
              {o.texto}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground" data-testid="enquete-rodape">
        <span data-testid="enquete-total">{votos(enquete.totalVotos)}</span>
        <span aria-hidden="true">·</span>
        <span data-testid="enquete-estado">{estado}</span>
      </div>

      {enquete.motivo === 'seguidores' && (
        <div className="mt-1 flex flex-wrap items-center gap-2" data-testid="enquete-so-seguidores">
          <p className="text-sm font-medium text-foreground">Só seguidores podem votar</p>
          <button type="button" onClick={() => { void aoSeguir(); }} disabled={seguir.isPending || seguirEnviado} data-testid="enquete-seguir"
            className="min-h-[44px] rounded-full bg-primary/10 px-4 text-sm font-bold text-primary hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
            {seguirEnviado ? 'A aguardar aprovação' : `Seguir @${post.autor.username}`}
          </button>
        </div>
      )}
    </div>
  );
}
