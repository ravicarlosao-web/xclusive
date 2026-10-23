import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { MINHAS_SUBS_KEY, SubscricaoError, formatarData, kz, type MinhaSubscricao } from '@/lib/subscricoes';
import { AlertCircle, CalendarDays, CheckCircle2, Loader2, Wallet } from 'lucide-react';

/**
 * Diálogos de renovar e cancelar uma subscrição. Tudo vem do servidor (GET /subscriptions/me):
 * preço atual do plano, fim do período (periodoAtual) e datas. Renovar debita UMA vez: o botão fica
 * bloqueado durante o pedido e o servidor recusa (409) um segundo pedido com o mesmo periodoAtual.
 */

type RenovarFase = 'confirmar' | 'a-enviar' | 'sucesso' | 'erro';

export function RenovarDialog({ sub, open, onClose }: { sub: MinhaSubscricao | null; open: boolean; onClose: () => void }) {
  const { renovarSubscricao, saldo } = useAuth();
  const queryClient = useQueryClient();
  const [fase, setFase] = useState<RenovarFase>('confirmar');
  const [mensagem, setMensagem] = useState('');
  const [novoFim, setNovoFim] = useState<string | null>(null);
  const [semSaldo, setSemSaldo] = useState(false);
  const enviando = useRef(false);

  useEffect(() => {
    if (open) { setFase('confirmar'); setMensagem(''); setNovoFim(null); setSemSaldo(false); enviando.current = false; }
  }, [open, sub?.id]);

  if (!sub) return null;
  const preco = sub.preco;
  const temSaldo = preco != null && saldo !== null && saldo >= preco;

  async function confirmar() {
    if (enviando.current || !sub || sub.preco == null || !sub.renovacaoEm) return; // clique duplo: só o primeiro conta
    enviando.current = true;
    setFase('a-enviar');
    try {
      const r = await renovarSubscricao(sub.id, sub.renovacaoEm, sub.preco);
      setNovoFim(r.renovacaoEm);
      setFase('sucesso');
    } catch (e) {
      const err = e as SubscricaoError;
      setSemSaldo(err.status === 402);
      setMensagem(err.message || 'Não foi possível renovar.');
      setFase('erro');
      // 409: preço ou período mudaram (ou já foi renovada): recarrega o estado verdadeiro.
      if (err.status === 409) void queryClient.invalidateQueries({ queryKey: MINHAS_SUBS_KEY });
    } finally {
      enviando.current = false;
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[400px] bg-card border-border rounded-2xl" data-testid="renovar-dialog">
        {fase === 'confirmar' && (
          <>
            <DialogHeader>
              <DialogTitle>Renovar subscrição</DialogTitle>
              <DialogDescription>
                @{sub.criador.username}{sub.plano ? ` · ${sub.plano.nome}` : ''}
              </DialogDescription>
            </DialogHeader>
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Valor da renovação (1 mês)</span>
                <span className="font-bold text-primary" data-testid="renovar-preco">{preco != null ? kz(preco) : '—'}</span>
              </div>
              <div className="flex items-start gap-2 text-xs text-muted-foreground">
                <CalendarDays className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  {sub.temAcesso && sub.renovacaoEm
                    ? <>Prolonga o acesso a partir de <strong className="text-foreground">{formatarData(sub.renovacaoEm)}</strong>.</>
                    : <>O acesso volta a partir de hoje. A data de fim é confirmada no fim.</>}
                  {' '}Renovação sempre manual.
                </span>
              </div>
            </div>
            <div className={`flex items-center gap-2.5 rounded-xl p-3 text-sm ${temSaldo ? 'bg-secondary/50 border border-border' : 'bg-destructive/10 border border-destructive/30'}`}>
              <Wallet className={`w-4 h-4 shrink-0 ${temSaldo ? 'text-yellow-700 dark:text-yellow-500' : 'text-destructive'}`} />
              <div>
                <span className="text-muted-foreground">O teu saldo: </span>
                <span className="font-bold">{saldo != null ? kz(saldo) : '—'}</span>
                {!temSaldo && <p className="text-xs text-destructive mt-0.5">Saldo insuficiente. Carrega a tua carteira primeiro.</p>}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 rounded-xl" onClick={onClose}>Cancelar</Button>
              <Button className="flex-1 rounded-xl font-bold" disabled={!temSaldo || preco == null} onClick={confirmar} data-testid="renovar-confirmar">
                Renovar
              </Button>
            </div>
          </>
        )}
        {fase === 'a-enviar' && (
          <div className="py-8 flex flex-col items-center text-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="font-semibold">A renovar…</p>
          </div>
        )}
        {fase === 'sucesso' && (
          <div className="py-6 flex flex-col items-center text-center gap-3" data-testid="renovar-sucesso">
            <CheckCircle2 className="w-10 h-10 text-primary" />
            <h2 className="text-lg font-bold">Subscrição renovada</h2>
            <p className="text-sm text-muted-foreground">
              {novoFim ? <>Acesso até <strong className="text-foreground">{formatarData(novoFim)}</strong>.</> : 'Acesso prolongado.'}
            </p>
            <Button className="w-full rounded-xl" onClick={onClose}>Fechar</Button>
          </div>
        )}
        {fase === 'erro' && (
          <div className="py-4 flex flex-col items-center text-center gap-3" data-testid="renovar-erro">
            <AlertCircle className="w-10 h-10 text-destructive" />
            <h2 className="text-lg font-bold">Não foi possível renovar</h2>
            <p className="text-sm text-muted-foreground">{mensagem}</p>
            <div className="flex gap-2 w-full">
              <Button variant="outline" className="flex-1 rounded-xl" onClick={onClose}>Fechar</Button>
              {semSaldo && (
                <Link href="/carteira" className="flex-1">
                  <Button className="w-full rounded-xl" onClick={onClose}>Ir para a carteira</Button>
                </Link>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function CancelarDialog({ sub, open, onClose }: { sub: MinhaSubscricao | null; open: boolean; onClose: () => void }) {
  const { cancelarSubscricao } = useAuth();
  const [a_enviar, setAEnviar] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [feito, setFeito] = useState<{ acessoAte: string | null } | null>(null);
  const enviando = useRef(false);

  useEffect(() => {
    if (open) { setAEnviar(false); setMensagem(''); setFeito(null); enviando.current = false; }
  }, [open, sub?.id]);

  if (!sub) return null;
  const nome = sub.criador.nomeExibicao || sub.criador.username;

  async function confirmar() {
    if (enviando.current || !sub) return;
    enviando.current = true;
    setAEnviar(true);
    setMensagem('');
    try {
      setFeito(await cancelarSubscricao(sub.id));
    } catch (e) {
      setMensagem((e as SubscricaoError).message || 'Não foi possível cancelar.');
    } finally {
      enviando.current = false;
      setAEnviar(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[400px] bg-card border-border rounded-2xl" data-testid="cancelar-dialog">
        {!feito ? (
          <>
            <DialogHeader>
              <DialogTitle>Cancelar subscrição</DialogTitle>
              <DialogDescription>@{sub.criador.username}</DialogDescription>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              {sub.gratuita
                ? <>Deixas de ter acesso ao conteúdo exclusivo de {nome} <strong className="text-foreground">de imediato</strong>.</>
                : sub.acessoAte
                  ? <>Não será renovada. Manténs o acesso até <strong className="text-foreground">{formatarData(sub.acessoAte)}</strong>.</>
                  : <>Não será renovada.</>}
            </p>
            {mensagem && <p className="text-sm text-destructive" data-testid="cancelar-erro">{mensagem}</p>}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 rounded-xl" onClick={onClose}>Voltar</Button>
              <Button variant="destructive" className="flex-1 rounded-xl font-bold" disabled={a_enviar} onClick={confirmar} data-testid="cancelar-confirmar">
                {a_enviar ? 'A cancelar…' : 'Cancelar subscrição'}
              </Button>
            </div>
          </>
        ) : (
          <div className="py-6 flex flex-col items-center text-center gap-3" data-testid="cancelar-sucesso">
            <CheckCircle2 className="w-10 h-10 text-primary" />
            <h2 className="text-lg font-bold">Subscrição cancelada</h2>
            <p className="text-sm text-muted-foreground">
              {feito.acessoAte
                ? <>Manténs o acesso até <strong className="text-foreground">{formatarData(feito.acessoAte)}</strong>.</>
                : 'O acesso terminou.'}
            </p>
            <Button className="w-full rounded-xl" onClick={onClose}>Fechar</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
