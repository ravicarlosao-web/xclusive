import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { AlertCircle, CheckCircle2, Unlock, Wallet } from 'lucide-react';

interface UnlockPostModalProps {
  open: boolean;
  onClose: () => void;
  postId: number;
  creatorUsername: string;
  creatorNome: string;
  preco: number;
  onUnlocked: () => void;
}

type Phase = 'confirm' | 'loading' | 'success' | 'error';

export function UnlockPostModal({ open, onClose, postId, creatorUsername, creatorNome, preco, onUnlocked }: UnlockPostModalProps) {
  const { unlockPost, saldo } = useAuth();
  const [phase, setPhase] = useState<Phase>('confirm');
  const [errorMsg, setErrorMsg] = useState('');

  const hasSaldo = saldo !== null && saldo >= preco;

  function handleClose() {
    if (phase === 'success') onUnlocked();
    setPhase('confirm');
    setErrorMsg('');
    onClose();
  }

  async function handleConfirm() {
    setPhase('loading');
    try {
      await unlockPost(postId, creatorUsername, preco);
      setPhase('success');
    } catch (e: any) {
      setErrorMsg(e.message || 'Erro ao desbloquear conteúdo.');
      setPhase('error');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-[380px] bg-card border-border rounded-2xl p-0 overflow-hidden">

        {phase === 'confirm' && (
          <div className="p-6">
            <DialogHeader className="mb-5">
              <div className="flex items-center gap-3 mb-1">
                <div className="w-10 h-10 rounded-full bg-amber-500/15 flex items-center justify-center">
                  <Unlock className="w-5 h-5 text-amber-400" />
                </div>
                <DialogTitle className="text-xl font-bold">Desbloquear Conteúdo</DialogTitle>
              </div>
            </DialogHeader>

            <div className="bg-secondary/60 border border-border rounded-xl p-4 mb-5 space-y-2.5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Criador</span>
                <span className="font-semibold">@{creatorUsername}</span>
              </div>
              <div className="h-px bg-border" />
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Acesso</span>
                <span className="font-semibold">Pagamento único</span>
              </div>
              <div className="h-px bg-border" />
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Valor</span>
                <span className="text-lg font-bold text-amber-400">{preco.toLocaleString('pt-PT')} Kz</span>
              </div>
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
                className="flex-1 h-12 font-bold bg-amber-500 hover:bg-amber-400 text-black rounded-xl"
                disabled={!hasSaldo}
                onClick={handleConfirm}
              >
                Desbloquear
              </Button>
            </div>
          </div>
        )}

        {phase === 'loading' && (
          <div className="p-8 flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-full bg-amber-500/15 flex items-center justify-center mb-4 animate-pulse">
              <Unlock className="w-8 h-8 text-amber-400" />
            </div>
            <p className="font-semibold">A processar pagamento...</p>
          </div>
        )}

        {phase === 'success' && (
          <div className="p-8 flex flex-col items-center text-center">
            <div className="w-20 h-20 rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center mb-5">
              <CheckCircle2 className="w-10 h-10 text-green-400" />
            </div>
            <h2 className="text-xl font-bold mb-2">Conteúdo desbloqueado!</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Pagaste <span className="font-bold text-foreground">{preco.toLocaleString('pt-PT')} Kz</span> para aceder a este conteúdo de <span className="font-bold text-foreground">@{creatorUsername}</span>.
            </p>
            <Button className="w-full h-12 font-bold rounded-xl" onClick={handleClose}>
              Ver conteúdo
            </Button>
          </div>
        )}

        {phase === 'error' && (
          <div className="p-6">
            <div className="flex flex-col items-center text-center mb-5">
              <div className="w-16 h-16 rounded-full bg-destructive/15 flex items-center justify-center mb-4">
                <AlertCircle className="w-8 h-8 text-destructive" />
              </div>
              <h2 className="text-lg font-bold mb-2">Erro no pagamento</h2>
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
