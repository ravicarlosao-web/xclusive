import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth, XCLUSIVE_IBAN } from '@/contexts/AuthContext';
import { Wallet, Copy, Check, AlertCircle, CheckCircle2, ChevronRight, FileText, Upload, X } from 'lucide-react';
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
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [pdfName, setPdfName] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedAmount = amount !== '' ? amount : (customAmount ? parseInt(customAmount.replace(/\D/g, ''), 10) : 0);

  function handleReset() {
    setStep('amount');
    setAmount('');
    setCustomAmount('');
    setIbanInput('');
    setError('');
    setLoading(false);
    setPdfBase64(null);
    setPdfName('');
  }

  function handlePdfSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') {
      setError('Só são aceites ficheiros PDF.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('O PDF não pode ter mais de 5 MB.');
      return;
    }
    setError('');
    setPdfName(file.name);
    const reader = new FileReader();
    reader.onload = () => setPdfBase64(reader.result as string);
    reader.readAsDataURL(file);
  }

  function handleClose() {
    handleReset();
    onClose();
  }

  async function handleConfirm() {
    if (!pdfBase64) {
      setError('Anexa o comprovativo em PDF antes de continuar.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await topUp(selectedAmount, ibanInput, reference, pdfBase64, pdfName);
      setStep('success');
    } catch (e: any) {
      setError(e.message || 'Erro ao processar pedido.');
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

        {/* ── Step: Confirm IBAN + PDF ── */}
        {step === 'confirm' && (
          <div className="p-6">
            <DialogHeader className="mb-5">
              <DialogTitle className="text-xl font-bold">Confirmar Transferência</DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Introduz o IBAN da Xclusive e anexa o comprovativo em PDF.
              </p>
            </DialogHeader>

            {/* IBAN */}
            <div className="mb-4">
              <label className="text-xs text-muted-foreground font-medium mb-1.5 block">IBAN da Xclusive</label>
              <Input
                placeholder="AO06 0040 0000 1234 5678 9012 3"
                value={ibanInput}
                onChange={(e) => { setIbanInput(e.target.value); setError(''); }}
                className="bg-secondary border-border font-mono tracking-wider"
              />
            </div>

            {/* PDF upload */}
            <div className="mb-4">
              <label className="text-xs text-muted-foreground font-medium mb-1.5 block">
                Comprovativo de transferência <span className="text-destructive">*</span>
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={handlePdfSelect}
              />
              {!pdfBase64 ? (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-secondary/40 hover:bg-secondary/70 hover:border-yellow-500/50 transition-all py-6 text-muted-foreground"
                >
                  <Upload className="w-6 h-6" />
                  <span className="text-sm font-medium">Clica para anexar o PDF</span>
                  <span className="text-xs">Máximo 5 MB</span>
                </button>
              ) : (
                <div className="flex items-center gap-3 rounded-xl border border-green-500/30 bg-green-500/8 px-4 py-3">
                  <FileText className="w-5 h-5 text-green-400 shrink-0" />
                  <span className="flex-1 text-sm font-medium truncate text-green-300">{pdfName}</span>
                  <button
                    type="button"
                    onClick={() => { setPdfBase64(null); setPdfName(''); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                    className="p-1 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            {error && (
              <div className="flex items-center gap-2 text-destructive text-xs mb-3 bg-destructive/10 p-2.5 rounded-lg">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            <div className="flex gap-2 mt-5">
              <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setStep('transfer')}>
                Voltar
              </Button>
              <Button
                className="flex-1 h-12 font-bold bg-yellow-500 hover:bg-yellow-400 text-black rounded-xl"
                disabled={!ibanInput.trim() || loading}
                onClick={handleConfirm}
              >
                {loading ? 'A enviar...' : 'Submeter pedido'}
              </Button>
            </div>
          </div>
        )}

        {/* ── Step: Success ── */}
        {step === 'success' && (
          <div className="p-8 flex flex-col items-center text-center">
            <div className="w-20 h-20 rounded-full bg-yellow-500/15 border border-yellow-500/30 flex items-center justify-center mb-5">
              <CheckCircle2 className="w-10 h-10 text-yellow-400" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Pedido enviado!</h2>
            <p className="text-muted-foreground mb-4">
              O teu pedido de carregamento de{' '}
              <span className="font-bold text-foreground">{selectedAmount.toLocaleString('pt-PT')} Kz</span>{' '}
              foi registado com a referência{' '}
              <span className="font-bold font-mono text-primary">{reference}</span>.
            </p>
            <div className="w-full bg-secondary/60 border border-border rounded-xl p-3 mb-6 text-left">
              <p className="text-xs text-muted-foreground leading-relaxed">
                <span className="font-semibold text-foreground">O que acontece a seguir:</span><br />
                A nossa equipa vai verificar a transferência bancária e aprovar o carregamento manualmente. O saldo aparece na tua carteira assim que for confirmado, normalmente em alguns minutos a horas úteis.
              </p>
            </div>
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
