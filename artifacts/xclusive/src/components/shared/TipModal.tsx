import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Coins, Wallet, CheckCircle2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const PRESET_AMOUNTS = [50, 100, 200, 500, 1000, 2000];

interface TipModalProps {
  open: boolean;
  onClose: () => void;
  creator: {
    username: string;
    nomeExibicao: string | null;
    avatarUrl: string | null;
    verificado: boolean;
  };
  postId?: number;
  /** Chamado após gorjeta enviada com sucesso */
  onTipSent?: () => void;
}

type Phase = 'select' | 'loading' | 'success';

export function TipModal({ open, onClose, creator, postId, onTipSent }: TipModalProps) {
  const { saldo, sendTip } = useAuth();
  const { toast } = useToast();
  const [selected, setSelected] = useState<number | null>(null);
  const [custom, setCustom] = useState('');
  const [phase, setPhase] = useState<Phase>('select');

  const effectiveAmount = selected ?? (custom ? parseInt(custom, 10) : null);
  const canSend =
    effectiveAmount !== null &&
    effectiveAmount > 0 &&
    (saldo === null || effectiveAmount <= saldo);

  const handleClose = () => {
    if (phase === 'loading') return;
    setPhase('select');
    setSelected(null);
    setCustom('');
    onClose();
  };

  const handleSend = async () => {
    if (!effectiveAmount || effectiveAmount <= 0) return;
    if (saldo !== null && effectiveAmount > saldo) {
      toast({ variant: 'destructive', title: 'Saldo insuficiente', description: `Tens ${saldo.toLocaleString('pt-PT')} Kz. Carrega a tua carteira.` });
      return;
    }
    setPhase('loading');
    try {
      await sendTip(creator.username, effectiveAmount, postId);
      setPhase('success');
      onTipSent?.();
    } catch (err: any) {
      setPhase('select');
      toast({ variant: 'destructive', title: 'Erro ao enviar gorjeta', description: err?.message || 'Tenta de novo.' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && handleClose()}>
      <DialogContent className="max-w-sm p-0 overflow-hidden rounded-3xl border-border bg-card gap-0">
        <AnimatePresence mode="wait">
          {phase === 'success' ? (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', bounce: 0.4 }}
              className="flex flex-col items-center py-12 px-6 text-center gap-4"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: [0, 1.3, 1] }}
                transition={{ delay: 0.1, duration: 0.5, times: [0, 0.6, 1] }}
                className="w-20 h-20 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center shadow-[0_0_40px_rgba(251,191,36,0.4)]"
              >
                <CheckCircle2 className="w-10 h-10 text-white" />
              </motion.div>
              <div>
                <p className="text-2xl font-extrabold mb-1">Gorjeta enviada! 🎉</p>
                <p className="text-muted-foreground text-sm">
                  Enviaste <span className="font-bold text-foreground">{effectiveAmount?.toLocaleString('pt-PT')} Kz</span> para{' '}
                  <span className="font-bold text-foreground">@{creator.username}</span>
                </p>
              </div>
              {saldo !== null && (
                <p className="text-xs text-muted-foreground bg-secondary px-3 py-1.5 rounded-full">
                  Saldo restante: <span className="font-semibold text-foreground">{saldo.toLocaleString('pt-PT')} Kz</span>
                </p>
              )}
              <Button onClick={handleClose} className="w-full mt-2 h-12 rounded-2xl font-bold bg-primary hover:bg-primary/90 text-white">
                Fechar
              </Button>
            </motion.div>
          ) : (
            <motion.div key="select" initial={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {/* Header */}
              <div className="relative bg-gradient-to-b from-primary/10 to-transparent pt-8 pb-5 px-6 flex flex-col items-center gap-3">
                <div className="relative">
                  <Avatar className="w-16 h-16 border-2 border-border shadow-xl">
                    <AvatarImage src={creator.avatarUrl || ''} />
                    <AvatarFallback className="text-xl font-bold">{(creator.nomeExibicao || creator.username)[0].toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="absolute -bottom-1 -right-1 w-7 h-7 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-full flex items-center justify-center shadow-md">
                    <Coins className="w-4 h-4 text-white" />
                  </div>
                </div>
                <div className="text-center">
                  <p className="font-bold text-base leading-tight">
                    {creator.nomeExibicao || creator.username}
                    {creator.verificado && (
                      <svg className="inline w-4 h-4 text-primary fill-current ml-1 -mt-0.5" viewBox="0 0 24 24"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-1.9 14.7L6 12.6l1.5-1.5 2.6 2.6 6.4-6.4 1.5 1.5-7.9 7.9z"/></svg>
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">@{creator.username}</p>
                </div>
                {saldo !== null && (
                  <div className="flex items-center gap-1.5 bg-secondary border border-border rounded-full px-3 py-1">
                    <Wallet className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold">{saldo.toLocaleString('pt-PT')} Kz</span>
                  </div>
                )}
              </div>

              <div className="px-6 pb-6 flex flex-col gap-4">
                {/* Preset amounts */}
                <div>
                  <p className="text-xs text-muted-foreground mb-2 font-medium">Escolhe o valor</p>
                  <div className="grid grid-cols-3 gap-2">
                    {PRESET_AMOUNTS.map(amt => (
                      <button
                        key={amt}
                        onClick={() => { setSelected(amt); setCustom(''); }}
                        className={cn(
                          'h-11 rounded-xl text-sm font-bold border transition-all duration-150',
                          selected === amt
                            ? 'bg-primary border-primary text-white shadow-[0_0_16px_rgba(255,62,114,0.35)]'
                            : 'bg-secondary border-border text-foreground hover:border-primary/50 hover:bg-primary/5'
                        )}
                      >
                        {amt < 1000 ? `${amt} Kz` : `${amt / 1000}k Kz`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom amount */}
                <div>
                  <p className="text-xs text-muted-foreground mb-2 font-medium">Ou insere um valor personalizado</p>
                  <div className="relative">
                    <Input
                      type="number"
                      min={1}
                      placeholder="Ex: 750"
                      value={custom}
                      onChange={e => { setCustom(e.target.value); setSelected(null); }}
                      className="h-11 rounded-xl pr-12 bg-secondary border-border focus:border-primary"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-medium">Kz</span>
                  </div>
                  {saldo !== null && effectiveAmount !== null && effectiveAmount > saldo && (
                    <p className="text-xs text-destructive mt-1">Saldo insuficiente — tens {saldo.toLocaleString('pt-PT')} Kz.</p>
                  )}
                </div>

                {/* Send button */}
                <Button
                  onClick={handleSend}
                  disabled={!canSend || phase === 'loading'}
                  className="h-13 rounded-2xl font-bold text-base w-full bg-gradient-to-r from-yellow-500 to-orange-500 hover:opacity-90 text-white shadow-[0_4px_24px_rgba(251,191,36,0.3)] disabled:opacity-40 disabled:shadow-none"
                >
                  {phase === 'loading' ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <Coins className="w-5 h-5 mr-2" />
                      {effectiveAmount ? `Dar ${effectiveAmount.toLocaleString('pt-PT')} Kz` : 'Dar gorjeta'}
                    </>
                  )}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
