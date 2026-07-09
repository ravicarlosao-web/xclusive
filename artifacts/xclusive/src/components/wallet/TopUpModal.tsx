import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth, XCLUSIVE_IBAN } from '@/contexts/AuthContext';
import { Wallet, Copy, Check, AlertCircle, CheckCircle2, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TopUpModalProps {
  open: boolean;
  onClose: () => void;
}

const PRESET_AMOUNTS = [1000, 2500, 5000, 10000, 25000, 50000];

type Step = 'amount' | 'transfer' | 'confirm' | 'success';

export function TopUpModal({ open, onClose }: TopUpModalProps) {
  const { topUp, saldo } = useAuth();
  const [step, setStep] = useState<Step>('amount');
  const [amount, setAmount] = useState<number | ''>('');
  const [customAmount, setCustomAmount] = useState('');
  const [ibanInput, setIbanInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copiedIban, setCopiedIban] = useState(false);
  const [reference] = useState(() => {
    // Generate a unique reference number per modal instance
    const rand = Math.floor(100000 + Math.random() * 900000);
    return `XCL-${rand}`;
  });

  const selectedAmount = amount !== '' ? amount : (customAmount ? parseInt(customAmount.replace(/\D/g, ''), 10) : 0);

  function handleReset() {
    setStep('amount');
    setAmount('');
    setCustomAmount('');
    setIbanInput('');
    setError('');
    setLoading(false);
  }

  function handleClose() {
    handleReset();
    onClose();
  }

  async function handleConfirm() {
    setError('');
    setLoading(true);
    try {
      await topUp(selectedAmount, ibanInput);
      setStep('success');
    } catch (e: any) {
      setError(e.message || 'Erro ao processar carregamento.');
    } finally {
      setLoading(false);
    }
  }

  function copyIban() {
    navigator.clipboard.writeText(XCLUSIVE_IBAN).then(() => {
      setCopiedIban(true);
      setTimeout(() => setCopiedIban(false), 2000);
    });
  }

  const isAmountValid = selectedAmount >= 500;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-[420px] bg-card border-border rounded-2xl p-0 overflow-hidden">

        {/* ── Step: Amount ── */}
        {step === 'amount' && (
          <div className="p-6">
            <DialogHeader className="mb-6">
              <div className="flex items-center gap-3 mb-1">
                <div className="w-10 h-10 rounded-full bg-yellow-500/15 flex items-center justify-center">
                  <Wallet className="w-5 h-5 text-yellow-500" />
                </div>
                <DialogTitle className="text-xl font-bold">Carregar Carteira</DialogTitle>
              </div>
              {saldo !== null && (
                <p className="text-sm text-muted-foreground ml-[52px]">
                  Saldo atual: <span className="font-semibold text-foreground">{saldo.toLocaleString('pt-PT')} Kz</span>
                </p>
              )}
            </DialogHeader>

            <p className="text-sm text-muted-foreground mb-4">Escolhe o valor a carregar:</p>

            <div className="grid grid-cols-3 gap-2 mb-4">
              {PRESET_AMOUNTS.map((v) => (
                <button
                  key={v}
                  onClick={() => { setAmount(v); setCustomAmount(''); }}
                  className={cn(
                    "py-2.5 px-3 rounded-xl text-sm font-bold transition-all border",
                    amount === v
                      ? "bg-yellow-500 text-black border-yellow-500 shadow-[0_0_16px_rgba(234,179,8,0.4)]"
                      : "bg-secondary border-border text-foreground hover:border-yellow-500/50"
                  )}
                >
                  {v.toLocaleString('pt-PT')} Kz
                </button>
              ))}
            </div>

            <div className="mb-6">
              <label className="text-xs text-muted-foreground font-medium mb-1.5 block">Ou introduz um valor personalizado:</label>
              <div className="relative">
                <Input
                  placeholder="Ex: 15.000"
                  value={customAmount}
                  onChange={(e) => {
                    setCustomAmount(e.target.value);
                    setAmount('');
                  }}
                  className="pr-12 bg-secondary border-border"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">Kz</span>
              </div>
              {selectedAmount > 0 && selectedAmount < 500 && (
                <p className="text-xs text-destructive mt-1">Valor mínimo: 500 Kz</p>
              )}
            </div>

            <Button
              className="w-full h-12 font-bold text-base bg-yellow-500 hover:bg-yellow-400 text-black rounded-xl"
              disabled={!isAmountValid}
              onClick={() => setStep('transfer')}
            >
              Continuar · {isAmountValid ? selectedAmount.toLocaleString('pt-PT') + ' Kz' : '–'}
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {/* ── Step: Transfer Instructions ── */}
        {step === 'transfer' && (
          <div className="p-6">
            <DialogHeader className="mb-5">
              <DialogTitle className="text-xl font-bold">Dados para Transferência</DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Faz uma transferência bancária de <span className="font-bold text-foreground">{selectedAmount.toLocaleString('pt-PT')} Kz</span> para a conta abaixo.
              </p>
            </DialogHeader>

            <div className="bg-secondary/60 border border-border rounded-xl p-4 space-y-3 mb-5">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold mb-1">Beneficiário</p>
                <p className="text-sm font-bold">Xclusive Platform, Lda.</p>
              </div>
              <div className="h-px bg-border" />
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold mb-1">IBAN</p>
                <div className="flex items-center justify-between gap-2">
                  <code className="text-sm font-bold font-mono tracking-wider">{XCLUSIVE_IBAN}</code>
                  <button
                    onClick={copyIban}
                    className="shrink-0 p-1.5 rounded-lg bg-background border border-border hover:bg-secondary transition-colors"
                  >
                    {copiedIban ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </div>
              </div>
              <div className="h-px bg-border" />
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold mb-1">Referência (obrigatória)</p>
                <p className="text-sm font-bold font-mono text-primary">{reference}</p>
              </div>
              <div className="h-px bg-border" />
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold mb-1">Valor</p>
                <p className="text-sm font-bold">{selectedAmount.toLocaleString('pt-PT')} Kz</p>
              </div>
            </div>

            <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 mb-5">
              <AlertCircle className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
              <p className="text-xs text-yellow-200/80">
                Inclui sempre a referência <strong className="text-yellow-400">{reference}</strong> na descrição da transferência para identificar o teu pagamento.
              </p>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setStep('amount')}>
                Voltar
              </Button>
              <Button
                className="flex-1 h-12 font-bold bg-yellow-500 hover:bg-yellow-400 text-black rounded-xl"
                onClick={() => setStep('confirm')}
              >
                Já transferi
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Step: Confirm IBAN ── */}
        {step === 'confirm' && (
          <div className="p-6">
            <DialogHeader className="mb-5">
              <DialogTitle className="text-xl font-bold">Confirmar Transferência</DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Para confirmar o carregamento de <span className="font-bold text-foreground">{selectedAmount.toLocaleString('pt-PT')} Kz</span>, introduz o IBAN da Xclusive:
              </p>
            </DialogHeader>

            <div className="mb-2">
              <label className="text-xs text-muted-foreground font-medium mb-1.5 block">IBAN da Xclusive</label>
              <Input
                placeholder="AO06 0040 0000 1234 5678 9012 3"
                value={ibanInput}
                onChange={(e) => { setIbanInput(e.target.value); setError(''); }}
                className="bg-secondary border-border font-mono tracking-wider"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-destructive text-xs mt-2 mb-3 bg-destructive/10 p-2.5 rounded-lg">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            <p className="text-xs text-muted-foreground mb-5 mt-3">
              Este passo verifica que fizeste a transferência para a conta correta.
            </p>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setStep('transfer')}>
                Voltar
              </Button>
              <Button
                className="flex-1 h-12 font-bold bg-yellow-500 hover:bg-yellow-400 text-black rounded-xl"
                disabled={!ibanInput.trim() || loading}
                onClick={handleConfirm}
              >
                {loading ? 'A verificar...' : 'Confirmar'}
              </Button>
            </div>
          </div>
        )}

        {/* ── Step: Success ── */}
        {step === 'success' && (
          <div className="p-8 flex flex-col items-center text-center">
            <div className="w-20 h-20 rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center mb-5">
              <CheckCircle2 className="w-10 h-10 text-green-400" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Carteira carregada!</h2>
            <p className="text-muted-foreground mb-2">
              <span className="font-bold text-foreground">{selectedAmount.toLocaleString('pt-PT')} Kz</span> foram adicionados à tua carteira.
            </p>
            {saldo !== null && (
              <p className="text-sm text-muted-foreground mb-6">
                Novo saldo: <span className="font-bold text-yellow-400 text-base">{saldo.toLocaleString('pt-PT')} Kz</span>
              </p>
            )}
            <Button
              className="w-full h-12 font-bold rounded-xl"
              onClick={handleClose}
            >
              Fechar
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
