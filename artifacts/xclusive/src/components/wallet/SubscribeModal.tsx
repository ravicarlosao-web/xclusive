import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuth } from '@/contexts/AuthContext';
import { AlertCircle, CheckCircle2, Sparkles, Wallet, CalendarDays } from 'lucide-react';

interface SubscribeModalProps {
  open: boolean;
  onClose: () => void;
  creatorUsername: string;
  creatorNome: string;
  creatorAvatar: string | null;
  creatorVerificado: boolean;
  preco: number; // monthly price in Kz
  onSubscribed: () => void;
}

type Phase = 'confirm' | 'loading' | 'success' | 'error';

export function SubscribeModal({
  open, onClose, creatorUsername, creatorNome, creatorAvatar, creatorVerificado, preco, onSubscribed
}: SubscribeModalProps) {
  const { subscribe, saldo } = useAuth();
  const [phase, setPhase] = useState<Phase>('confirm');
  const [errorMsg, setErrorMsg] = useState('');

  const hasSaldo = saldo !== null && saldo >= preco;
  const expiraEm = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString('pt-PT', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  function handleClose() {
    if (phase === 'success') onSubscribed();
    setPhase('confirm');
    setErrorMsg('');
    onClose();
  }

  async function handleConfirm() {
    setPhase('loading');
    try {
      await subscribe(creatorUsername, preco);
      setPhase('success');
    } catch (e: any) {
      setErrorMsg(e.message || 'Erro ao processar subscrição.');
      setPhase('error');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-[400px] bg-card border-border rounded-2xl p-0 overflow-hidden">

        {phase === 'confirm' && (
          <div className="p-6">
            {/* Creator header */}
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

            {/* Plan details */}
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 mb-5">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-primary" />
                <span className="font-bold text-sm">Plano VIP Club</span>
              </div>
              <ul className="space-y-1.5 text-sm text-muted-foreground mb-3">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                  Acesso a todo o conteúdo exclusivo
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                  Chat direto com o criador
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                  Lives privadas e conteúdo bónus
                </li>
              </ul>
              <div className="h-px bg-border/50 mb-3" />
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Valor mensal</span>
                <span className="text-xl font-bold text-primary">{preco.toLocaleString('pt-PT')} Kz</span>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
              <CalendarDays className="w-3.5 h-3.5 shrink-0" />
              <span>Subscrição válida até <strong className="text-foreground">{expiraEm}</strong>. Renovação manual.</span>
            </div>

            {/* Balance check */}
            <div className={`flex items-center gap-2.5 rounded-xl p-3 mb-5 text-sm ${hasSaldo ? 'bg-secondary/50 border border-border' : 'bg-destructive/10 border border-destructive/30'}`}>
              <Wallet className={`w-4 h-4 shrink-0 ${hasSaldo ? 'text-yellow-500' : 'text-destructive'}`} />
              <div>
                <span className="text-muted-foreground">O teu saldo: </span>
                <span className={`font-bold ${hasSaldo ? 'text-foreground' : 'text-destructive'}`}>
                  {saldo?.toLocaleString('pt-PT') ?? '—'} Kz
                </span>
                {!hasSaldo && (
                  <p className="text-xs text-destructive mt-0.5">Saldo insuficiente. Carrega a tua carteira primeiro.</p>
                )}
              </div>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 rounded-xl" onClick={handleClose}>
                Cancelar
              </Button>
              <Button
                className="flex-1 h-12 font-bold bg-primary hover:bg-primary/90 text-white rounded-xl shadow-[0_0_20px_rgba(255,62,114,0.3)]"
                disabled={!hasSaldo}
                onClick={handleConfirm}
              >
                Subscrever
              </Button>
            </div>
          </div>
        )}

        {phase === 'loading' && (
          <div className="p-8 flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-full bg-primary/15 flex items-center justify-center mb-4 animate-pulse">
              <Sparkles className="w-8 h-8 text-primary" />
            </div>
            <p className="font-semibold">A processar subscrição...</p>
          </div>
        )}

        {phase === 'success' && (
          <div className="p-8 flex flex-col items-center text-center">
            <div className="w-20 h-20 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center mb-5">
              <CheckCircle2 className="w-10 h-10 text-primary" />
            </div>
            <h2 className="text-xl font-bold mb-2">Subscrição ativa!</h2>
            <p className="text-sm text-muted-foreground mb-1">
              Já és subscritor de <span className="font-bold text-foreground">@{creatorUsername}</span>.
            </p>
            <p className="text-xs text-muted-foreground mb-6">
              Válida até <strong className="text-foreground">{expiraEm}</strong>.
            </p>
            <Button className="w-full h-12 font-bold rounded-xl" onClick={handleClose}>
              Ver conteúdo exclusivo
            </Button>
          </div>
        )}

        {phase === 'error' && (
          <div className="p-6">
            <div className="flex flex-col items-center text-center mb-5">
              <div className="w-16 h-16 rounded-full bg-destructive/15 flex items-center justify-center mb-4">
                <AlertCircle className="w-8 h-8 text-destructive" />
              </div>
              <h2 className="text-lg font-bold mb-2">Erro na subscrição</h2>
              <p className="text-sm text-muted-foreground">{errorMsg}</p>
            </div>
            <Button className="w-full rounded-xl" variant="outline" onClick={handleClose}>
              Fechar
            </Button>
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}
