import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuth } from '@/contexts/AuthContext';
import {
  SubscricaoError, ehSessaoMock, fetchPlanoCriador, formatarData, kz, type PlanoCriador,
} from '@/lib/subscricoes';
import { AlertCircle, CalendarDays, CheckCircle2, Loader2, Sparkles, Wallet } from 'lucide-react';

interface SubscribeModalProps {
  open: boolean;
  onClose: () => void;
  creatorUsername: string;
  creatorNome: string;
  creatorAvatar: string | null;
  creatorVerificado: boolean;
  onSubscribed: () => void;
}

type Phase = 'a-carregar' | 'confirm' | 'sending' | 'success' | 'error' | 'indisponivel';

/** Só a sessão de demonstração (modo mock) não tem servidor: usa este plano fictício. */
const PLANO_MOCK: PlanoCriador = { id: 0, criadorId: 0, tipoSubscricao: 'paga', nome: 'Plano mensal (demonstração)', preco: 4990, beneficios: null };

/**
 * Subscrever: o plano, o preço e a data de fim vêm SEMPRE do servidor.
 *  - paga: mostra o plano real e envia { planoId, precoEsperado = preço que o utilizador viu };
 *  - gratuita: sem cobrança, envia { criadorId }.
 */
export function SubscribeModal({
  open, onClose, creatorUsername, creatorNome, creatorAvatar, creatorVerificado, onSubscribed,
}: SubscribeModalProps) {
  const { subscribe, saldo } = useAuth();
  const [phase, setPhase] = useState<Phase>('a-carregar');
  const [plano, setPlano] = useState<PlanoCriador | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [aviso, setAviso] = useState('');
  const [semSaldo, setSemSaldo] = useState(false);
  const [fim, setFim] = useState<string | null>(null);
  const enviando = useRef(false);

  const gratuita = plano?.tipoSubscricao === 'gratuita';
  const preco = plano?.preco ?? 0;
  const hasSaldo = gratuita || (saldo !== null && saldo >= preco);

  async function carregarPlano(manterAviso = false) {
    if (ehSessaoMock()) { setPlano(PLANO_MOCK); setPhase('confirm'); return; }
    setPhase('a-carregar');
    if (!manterAviso) setAviso('');
    try {
      setPlano(await fetchPlanoCriador(creatorUsername));
      setPhase('confirm');
    } catch (e) {
      setErrorMsg((e as SubscricaoError).message || 'Esta criadora não tem plano disponível.');
      setPhase('indisponivel');
    }
  }

  useEffect(() => {
    if (open) {
      setErrorMsg(''); setSemSaldo(false); setFim(null); enviando.current = false;
      void carregarPlano();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, creatorUsername]);

  function handleClose() {
    if (phase === 'success') onSubscribed();
    onClose();
  }

  async function handleConfirm() {
    if (enviando.current || !plano) return; // clique duplo: só o primeiro conta
    enviando.current = true;
    setPhase('sending');
    try {
      const r = await subscribe(creatorUsername, plano.preco, ehSessaoMock() ? undefined : plano);
      setFim(r?.renovacaoEm ?? null);
      setPhase('success');
    } catch (e) {
      const err = e as SubscricaoError;
      if (err.status === 409 && !/Já tens/i.test(err.message)) {
        // Preço ou tipo mudaram entretanto: mostra o plano atualizado para o utilizador confirmar de novo.
        setAviso(err.message);
        await carregarPlano(true);
      } else {
        setSemSaldo(err.status === 402);
        setErrorMsg(err.message || 'Erro ao processar subscrição.');
        setPhase('error');
      }
    } finally {
      enviando.current = false;
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-[400px] bg-card border-border rounded-2xl p-0 overflow-hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>Subscrever @{creatorUsername}</DialogTitle>
          <DialogDescription>Confirma a subscrição</DialogDescription>
        </DialogHeader>

        {phase === 'a-carregar' && (
          <div className="p-8 flex flex-col items-center text-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">A obter o plano…</p>
          </div>
        )}

        {phase === 'indisponivel' && (
          <div className="p-6 text-center" data-testid="subscrever-indisponivel">
            <AlertCircle className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <h2 className="text-lg font-bold mb-2">Subscrição indisponível</h2>
            <p className="text-sm text-muted-foreground mb-5">{errorMsg}</p>
            <Button className="w-full rounded-xl" variant="outline" onClick={handleClose}>Fechar</Button>
          </div>
        )}

        {phase === 'confirm' && plano && (
          <div className="p-6">
            <div className="flex flex-col items-center text-center mb-5 pt-2">
              <div className="relative mb-3">
                <Avatar className="w-16 h-16 border-2 border-primary">
                  <AvatarImage src={creatorAvatar || ''} />
                  <AvatarFallback className="text-xl font-bold">{creatorNome?.[0] ?? 'C'}</AvatarFallback>
                </Avatar>
                {creatorVerificado && (
                  <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                    <svg className="w-3 h-3 text-white fill-current" viewBox="0 0 24 24"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-1.9 14.7L6 12.6l1.5-1.5 2.6 2.6 6.4-6.4 1.5 1.5-7.9 7.9z"/></svg>
                  </div>
                )}
              </div>
              <h2 className="text-xl font-bold">{creatorNome}</h2>
              <p className="text-sm text-muted-foreground">@{creatorUsername}</p>
            </div>

            {aviso && (
              <div className="mb-4 rounded-xl border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs text-yellow-600 dark:text-yellow-400" data-testid="subscrever-aviso">
                {aviso}
              </div>
            )}

            <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 mb-5">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-primary" />
                <span className="font-bold text-sm" data-testid="subscrever-plano">
                  {gratuita ? 'Subscrição gratuita' : plano.nome}
                </span>
              </div>
              {plano.beneficios && (
                <p className="text-sm text-muted-foreground whitespace-pre-line mb-3">{plano.beneficios}</p>
              )}
              <div className="h-px bg-border/50 mb-3" />
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">{gratuita ? 'Valor' : 'Valor mensal'}</span>
                <span className="text-xl font-bold text-primary" data-testid="subscrever-preco">
                  {gratuita ? 'Grátis' : kz(preco)}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
              <CalendarDays className="w-3.5 h-3.5 shrink-0" />
              <span>
                {gratuita
                  ? 'Acesso ao conteúdo exclusivo, sem data de fim e sem cobrança.'
                  : 'Dura 1 mês. A data de fim é confirmada no fim da subscrição. Renovação sempre manual.'}
              </span>
            </div>

            {!gratuita && (
              <div className={`flex items-center gap-2.5 rounded-xl p-3 mb-5 mt-3 text-sm ${hasSaldo ? 'bg-secondary/50 border border-border' : 'bg-destructive/10 border border-destructive/30'}`}>
                <Wallet className={`w-4 h-4 shrink-0 ${hasSaldo ? 'text-yellow-500' : 'text-destructive'}`} />
                <div>
                  <span className="text-muted-foreground">O teu saldo: </span>
                  <span className={`font-bold ${hasSaldo ? 'text-foreground' : 'text-destructive'}`}>
                    {saldo != null ? kz(saldo) : '—'}
                  </span>
                  {!hasSaldo && (
                    <p className="text-xs text-destructive mt-0.5">Saldo insuficiente. Carrega a tua carteira primeiro.</p>
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-2 mt-3">
              <Button variant="outline" className="flex-1 rounded-xl" onClick={handleClose}>Cancelar</Button>
              <Button
                className="flex-1 h-12 font-bold bg-primary hover:bg-primary/90 text-white rounded-xl shadow-[0_0_20px_rgba(255,62,114,0.3)]"
                disabled={!hasSaldo}
                onClick={handleConfirm}
                data-testid="subscrever-confirmar"
              >
                {gratuita ? 'Subscrever grátis' : 'Subscrever'}
              </Button>
            </div>
          </div>
        )}

        {phase === 'sending' && (
          <div className="p-8 flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-full bg-primary/15 flex items-center justify-center mb-4 animate-pulse">
              <Sparkles className="w-8 h-8 text-primary" />
            </div>
            <p className="font-semibold">A processar subscrição...</p>
          </div>
        )}

        {phase === 'success' && (
          <div className="p-8 flex flex-col items-center text-center" data-testid="subscrever-sucesso">
            <div className="w-20 h-20 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center mb-5">
              <CheckCircle2 className="w-10 h-10 text-primary" />
            </div>
            <h2 className="text-xl font-bold mb-2">Subscrição ativa!</h2>
            <p className="text-sm text-muted-foreground mb-1">
              Já és subscritor de <span className="font-bold text-foreground">@{creatorUsername}</span>.
            </p>
            {fim && (
              <p className="text-xs text-muted-foreground mb-6" data-testid="subscrever-fim">
                Válida até <strong className="text-foreground">{formatarData(fim)}</strong>.
              </p>
            )}
            {!fim && <div className="mb-6" />}
            <Button className="w-full h-12 font-bold rounded-xl" onClick={handleClose}>
              Ver conteúdo exclusivo
            </Button>
          </div>
        )}

        {phase === 'error' && (
          <div className="p-6" data-testid="subscrever-erro">
            <div className="flex flex-col items-center text-center mb-5">
              <div className="w-16 h-16 rounded-full bg-destructive/15 flex items-center justify-center mb-4">
                <AlertCircle className="w-8 h-8 text-destructive" />
              </div>
              <h2 className="text-lg font-bold mb-2">Erro na subscrição</h2>
              <p className="text-sm text-muted-foreground">{errorMsg}</p>
            </div>
            <div className="flex gap-2">
              <Button className="flex-1 rounded-xl" variant="outline" onClick={handleClose}>Fechar</Button>
              {semSaldo && (
                <Link href="/carteira" className="flex-1">
                  <Button className="w-full rounded-xl" onClick={handleClose}>Ir para a carteira</Button>
                </Link>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
