import { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { Wallet, Copy, Check, AlertCircle, CheckCircle2, ChevronRight, FileText, Upload, X, Smartphone, CreditCard, Receipt, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { lerLocal } from '@/lib/armazenamento';

interface TopUpModalProps {
  open: boolean;
  onClose: () => void;
}

const PRESET_AMOUNTS = [1000, 2500, 5000, 10000, 25000, 50000];

type Step = 'amount' | 'method' | 'transfer' | 'confirm' | 'success' | 'gpo_phone' | 'gpo_success' | 'ref_success' | 'kursipay_espera' | 'kursipay_ok' | 'kursipay_phone' | 'kursipay_ref' | 'kursipay_hospedado';

interface TopUpConfig {
  manual: { disponivel: boolean; nib?: string; nibFormatado?: string; titular?: string };
  gpo: { ativo: boolean; rotulo: string | null };
  ref: { ativo: boolean; rotulo: string | null };
}

/** «Pagar online» (kursiPay): só aparece quando o servidor o liga E esta conta é elegível. */
interface KursipayConfig { ativo: boolean; hospedado: boolean; direto: boolean; valorMin?: number; valorMax?: number }
interface KursipayReferencia { entidade: string; referencia: string; valor: number; validaAte: string | null }

export function TopUpModal({ open, onClose }: TopUpModalProps) {
  const { topUp, saldo } = useAuth();
  const [step, setStep] = useState<Step>('amount');
  const [amount, setAmount] = useState<number | ''>('');
  const [customAmount, setCustomAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // States for manual flow
  const [copiedIban, setCopiedIban] = useState(false);
  // Dados bancários e disponibilidade dos métodos: vêm do servidor (BD), nunca do código. A referência do pedido é interna (gerada no servidor) e o utilizador já não a vê.
  const [config, setConfig] = useState<TopUpConfig | null>(null);
  const [configErro, setConfigErro] = useState(false);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [pdfName, setPdfName] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // States for AppyPay flows
  const [paymentMethod, setPaymentMethod] = useState<'manual' | 'gpo' | 'ref' | 'kursipay'>('manual');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [refData, setRefData] = useState<{ entity: string; referenceNumber: string; dueDate: string } | null>(null);

  // Pagamento online (kursiPay, cobrança DIRETA): o utilizador nunca sai do site. Multicaixa Express: aprova no telemóvel; Referência: mostramos entidade e referência. O ecrã consulta o estado do pedido de poucos em poucos segundos enquanto está aberto.
  const [kursipay, setKursipay] = useState<KursipayConfig | null>(null);
  const [kursipayRef, setKursipayRef] = useState<KursipayReferencia | null>(null);
  const [kursipayUrl, setKursipayUrl] = useState('');                       // só no «Pagar online» (checkout hospedado)
  const [kursipayPendente, setKursipayPendente] = useState(false);          // Express: passaram ~90 s sem resposta
  const [kursipayVerificar, setKursipayVerificar] = useState(0);            // «Verificar agora»: recomeça a consulta
  const [copiado, setCopiado] = useState('');
  const [kursipayTopupId, setKursipayTopupId] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    let vivo = true;
    const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
    const token = lerLocal('xclusive_token');
    setConfigErro(false);
    fetch(`${base}/api/wallet/topup/config`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((c: TopUpConfig) => { if (vivo) setConfig(c); })
      .catch(() => { if (vivo) { setConfig(null); setConfigErro(true); } });
    fetch(`${base}/api/wallet/topup/kursipay/config`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((c: KursipayConfig) => { if (vivo) setKursipay(c); })
      .catch(() => { if (vivo) setKursipay(null); });
    return () => { vivo = false; };
  }, [open]);

  // Consulta do estado do pedido kursiPay (GET /estado, só o dono): de 3 em 3 s durante ~90 s. No Express, depois disso para e diz que ainda está pendente (com «Verificar agora»);
  // na Referência e no checkout hospedado o utilizador paga fora do ecrã, por isso continua mais devagar (15 s) enquanto o ecrã estiver aberto.
  useEffect(() => {
    if (!open || (step !== 'kursipay_espera' && step !== 'kursipay_ref' && step !== 'kursipay_hospedado') || kursipayTopupId === null) return;
    let vivo = true;
    let timer: number | undefined;
    const inicio = Date.now();
    const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
    const token = lerLocal('xclusive_token');
    setKursipayPendente(false);
    const consultar = () => {
      fetch(`${base}/api/wallet/topup/kursipay/${kursipayTopupId}/estado`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { resultado?: string } | null) => {
          if (!vivo) return;
          if (d?.resultado === 'pago') { setStep('kursipay_ok'); return; }
          if (d?.resultado === 'recusado') { setError('O pagamento não foi concluído (recusado ou expirado). Podes tentar de novo.'); setStep('method'); return; }
          agendar();
        })
        .catch(() => { if (vivo) agendar(); /* sem rede: tenta na próxima */ });
    };
    const agendar = () => {
      const passou = Date.now() - inicio;
      if (step === 'kursipay_espera' && passou >= 90_000) { setKursipayPendente(true); return; }
      timer = window.setTimeout(consultar, passou < 90_000 ? 3000 : 15000);
    };
    timer = window.setTimeout(consultar, 3000);
    return () => { vivo = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [open, step, kursipayTopupId, kursipayVerificar]);

  const selectedAmount = amount !== '' ? amount : (customAmount ? parseInt(customAmount.replace(/\D/g, ''), 10) : 0);

  function handleReset() {
    setStep('amount');
    setAmount('');
    setCustomAmount('');
    setError('');
    setLoading(false);
    setPdfBase64(null);
    setPdfName('');
    setPaymentMethod('manual');
    setPhoneNumber('');
    setRefData(null);
    setKursipayRef(null);
    setKursipayUrl('');
    setKursipayPendente(false);
    setCopiado('');
    setKursipayTopupId(null);
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

  // --- Submit Handlers ---

  async function handleConfirmManual() {
    if (!pdfBase64) {
      setError('Anexa o comprovativo em PDF antes de continuar.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await topUp(selectedAmount, pdfBase64, pdfName);
      setStep('success');
    } catch (e: any) {
      setError(e.message || 'Erro ao processar pedido.');
    } finally {
      setLoading(false);
    }
  }

  async function handleGpoSubmit() {
    if (phoneNumber.length < 9) {
      setError('Número de telemóvel inválido.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
      const token = lerLocal('xclusive_token');
      const res = await fetch(`${base}/api/wallet/topup/appypay/gpo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ amount: selectedAmount, phoneNumber })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao processar GPO');
      setStep('gpo_success');
    } catch (e: any) {
      setError(e.message || 'Erro ao processar pedido.');
    } finally {
      setLoading(false);
    }
  }

  async function handleRefSubmit() {
    setError('');
    setLoading(true);
    try {
      const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
      const token = lerLocal('xclusive_token');
      const res = await fetch(`${base}/api/wallet/topup/appypay/ref`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ amount: selectedAmount })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao gerar referência');
      
      setRefData({
        entity: data.entity,
        referenceNumber: data.referenceNumber,
        dueDate: data.dueDate,
      });
      setStep('ref_success');
    } catch (e: any) {
      setError(e.message || 'Erro ao processar pedido.');
    } finally {
      setLoading(false);
    }
  }

  async function handleKursipaySubmit(modo: 'express' | 'referencia' | 'hospedado') {
    if (kursipay?.valorMax && selectedAmount > kursipay.valorMax) { setError(`Valor máximo no pagamento online: ${kursipay.valorMax.toLocaleString('pt-PT')} Kz.`); return; }
    setError('');
    setLoading(true);
    try {
      const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
      const token = lerLocal('xclusive_token');
      const url = modo === 'hospedado' ? `${base}/api/wallet/topup/kursipay` : `${base}/api/wallet/topup/kursipay/${modo}`;
      const corpo = modo === 'express' ? { valor: selectedAmount, telefone: phoneNumber } : modo === 'referencia' ? { valor: selectedAmount } : { amount: selectedAmount };
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(corpo) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Não foi possível criar o pagamento.');
      if (typeof data.topupId !== 'number') throw new Error('Não foi possível criar o pagamento.');
      setKursipayTopupId(data.topupId);
      if (modo === 'referencia') {
        if (typeof data.entidade !== 'string' || typeof data.referencia !== 'string') throw new Error('Não foi possível gerar a referência.');
        setKursipayRef({ entidade: data.entidade, referencia: data.referencia, valor: Number(data.valor) || selectedAmount, validaAte: typeof data.validaAte === 'string' ? data.validaAte : null });
        setStep('kursipay_ref');
      } else if (modo === 'express') {
        setPhoneNumber('');   // o número não fica no ecrã nem na memória depois de enviado
        setStep('kursipay_espera');
      } else {
        if (typeof data.checkoutUrl !== 'string' || !data.checkoutUrl.startsWith('https://kursipay.com/')) throw new Error('Não foi possível abrir o pagamento.');
        setKursipayUrl(data.checkoutUrl);
        setStep('kursipay_hospedado');
        window.open(data.checkoutUrl, '_blank', 'noopener,noreferrer');   // se o navegador bloquear, a ligação do ecrã de espera faz o mesmo
      }
    } catch (e: any) {
      setError(e.message || 'Erro ao processar pedido.');
    } finally {
      setLoading(false);
    }
  }

  function copiar(texto: string, chave: string) {
    try { void navigator.clipboard.writeText(texto).then(() => { setCopiado(chave); window.setTimeout(() => setCopiado(''), 2000); }).catch(() => { /* sem permissão */ }); } catch { /* sem clipboard */ }
  }

  function handleMethodContinue() {
    if (paymentMethod === 'kursipay') { if (!kursipay?.hospedado) { setError('Este método não está disponível de momento.'); return; } void handleKursipaySubmit('hospedado'); return; }
    // Cobrança direta kursiPay (chave kursipay_direto_ativo ligada): os cartões «Multicaixa Express» e «Pagamento por Referência» passam a funcionar, sem sair do site.
    if (kursipay?.direto && paymentMethod === 'gpo') { setError(''); setStep('kursipay_phone'); return; }
    if (kursipay?.direto && paymentMethod === 'ref') { void handleKursipaySubmit('referencia'); return; }
    if ((paymentMethod === 'gpo' && !ativoGpo) || (paymentMethod === 'ref' && !ativoRef) || (paymentMethod === 'manual' && !ativoManual)) { setError('Este método não está disponível de momento.'); return; }
    if (paymentMethod === 'gpo') setStep('gpo_phone');
    else if (paymentMethod === 'ref') handleRefSubmit();
    else setStep('transfer'); // manual
  }

  function copyIban() {
    navigator.clipboard.writeText(config?.manual.nib ?? '').then(() => {
      setCopiedIban(true);
      setTimeout(() => setCopiedIban(false), 2000);
    });
  }

  const diretoKursipay = !!kursipay?.direto;
  const ativoGpo = !!config?.gpo.ativo || diretoKursipay, ativoRef = !!config?.ref.ativo || diretoKursipay, ativoManual = !!config?.manual.disponivel;
  const isAmountValid = selectedAmount >= 500;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-[420px] bg-card border-border rounded-2xl p-0 overflow-hidden">

        {/* ── Step 1: Amount ── */}
        {step === 'amount' && (
          <div className="p-6">
            <DialogHeader className="mb-6">
              <div className="flex items-center gap-3 mb-1">
                <div className="w-10 h-10 rounded-full bg-yellow-500/15 flex items-center justify-center">
                  <Wallet className="w-5 h-5 text-yellow-700 dark:text-yellow-500" />
                </div>
                <DialogTitle className="text-xl font-bold">Carregar Carteira</DialogTitle>
              </div>
              {saldo !== null && (
                <p className="text-sm text-muted-foreground ml-[52px]">
                  Saldo atual: <span className="font-semibold text-foreground">{saldo?.toLocaleString('pt-PT')} Kz</span>
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
                      ? "bg-yellow-500 text-black border-yellow-500 shadow-none dark:shadow-[0_0_16px_rgba(234,179,8,0.4)]"
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
              onClick={() => setStep('method')}
            >
              Continuar · {isAmountValid ? selectedAmount.toLocaleString('pt-PT') + ' Kz' : '–'}
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {/* ── Step 2: Payment Method ── */}
        {step === 'method' && (
          <div className="p-6">
            <DialogHeader className="mb-6">
              <DialogTitle className="text-xl font-bold">Método de Pagamento</DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Escolhe como pretendes pagar <span className="font-bold text-foreground">{selectedAmount.toLocaleString('pt-PT')} Kz</span>
              </p>
            </DialogHeader>

            <div className="space-y-3 mb-6">
              {kursipay?.hospedado && (
                <button
                  onClick={() => setPaymentMethod('kursipay')}
                  data-testid="metodo-kursipay"
                  className={cn(
                    "w-full flex items-center gap-4 p-4 rounded-xl border text-left transition-all",
                    paymentMethod === 'kursipay'
                      ? "border-yellow-500 bg-yellow-500/5 shadow-none dark:shadow-[0_0_12px_rgba(234,179,8,0.15)]"
                      : "border-border bg-secondary/30 hover:border-border/80"
                  )}
                >
                  <div className={cn("w-10 h-10 rounded-full flex items-center justify-center shrink-0", paymentMethod === 'kursipay' ? "bg-yellow-500 text-black" : "bg-secondary text-foreground")}>
                    <CreditCard className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-bold text-sm">Pagar online</h3>
                    <p className="text-xs text-muted-foreground">PayPay e outros métodos (abre a página de pagamento)</p>
                  </div>
                  <div className={cn("w-5 h-5 rounded-full border-2 flex items-center justify-center", paymentMethod === 'kursipay' ? "border-yellow-500 bg-yellow-500" : "border-muted")}>
                    {paymentMethod === 'kursipay' && <Check className="w-3 h-3 text-black" />}
                  </div>
                </button>
              )}
              <button
                onClick={() => ativoGpo && setPaymentMethod('gpo')}
                disabled={!ativoGpo}
                aria-disabled={!ativoGpo}
                data-testid="metodo-gpo"
                className={cn(
                  "w-full flex items-center gap-4 p-4 rounded-xl border text-left transition-all",
                  paymentMethod === 'gpo'
                    ? "border-yellow-500 bg-yellow-500/5 shadow-none dark:shadow-[0_0_12px_rgba(234,179,8,0.15)]"
                    : "border-border bg-secondary/30 hover:border-border/80",
                  !ativoGpo && "opacity-60 cursor-not-allowed"
                )}
              >
                <div className="w-12 h-12 rounded-lg bg-white flex items-center justify-center shrink-0 p-1 border border-border/50">
                  <img src="/mcx-express.png" alt="Multicaixa Express" className="w-full h-full object-contain" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-sm">Multicaixa Express</h3>
                  {ativoGpo ? <p className="text-xs text-muted-foreground">{diretoKursipay ? 'Aprova no telemóvel, sem sair daqui' : 'Aprovação imediata no telemóvel'}</p> : <p className="text-xs font-semibold text-yellow-700 dark:text-yellow-400" data-testid="brevemente-gpo">{config?.gpo.rotulo ?? 'Brevemente'}</p>}
                </div>
                <div className={cn("w-5 h-5 rounded-full border-2 flex items-center justify-center", paymentMethod === 'gpo' ? "border-yellow-500 bg-yellow-500" : "border-muted")}>
                  {paymentMethod === 'gpo' && <Check className="w-3 h-3 text-black" />}
                </div>
              </button>

              <button
                onClick={() => ativoRef && setPaymentMethod('ref')}
                disabled={!ativoRef}
                aria-disabled={!ativoRef}
                data-testid="metodo-ref"
                className={cn(
                  "w-full flex items-center gap-4 p-4 rounded-xl border text-left transition-all",
                  paymentMethod === 'ref'
                    ? "border-yellow-500 bg-yellow-500/5 shadow-none dark:shadow-[0_0_12px_rgba(234,179,8,0.15)]"
                    : "border-border bg-secondary/30 hover:border-border/80",
                  !ativoRef && "opacity-60 cursor-not-allowed"
                )}
              >
                <div className="w-12 h-12 rounded-lg bg-white flex items-center justify-center shrink-0 p-1 border border-border/50">
                  <img src="/multicaixa-ref.png" alt="Multicaixa" className="w-full h-full object-contain" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-sm">Pagamento por Referência</h3>
                  {ativoRef ? <p className="text-xs text-muted-foreground">{diretoKursipay ? 'Paga no ATM, Multicaixa Express ou banco' : 'Paga no ATM ou Homebanking'}</p> : <p className="text-xs font-semibold text-yellow-700 dark:text-yellow-400" data-testid="brevemente-ref">{config?.ref.rotulo ?? 'Brevemente'}</p>}
                </div>
                <div className={cn("w-5 h-5 rounded-full border-2 flex items-center justify-center", paymentMethod === 'ref' ? "border-yellow-500 bg-yellow-500" : "border-muted")}>
                  {paymentMethod === 'ref' && <Check className="w-3 h-3 text-black" />}
                </div>
              </button>

              <button
                onClick={() => ativoManual && setPaymentMethod('manual')}
                disabled={!ativoManual}
                aria-disabled={!ativoManual}
                data-testid="metodo-manual"
                className={cn(
                  "w-full flex items-center gap-4 p-4 rounded-xl border text-left transition-all",
                  paymentMethod === 'manual'
                    ? "border-yellow-500 bg-yellow-500/5 shadow-none dark:shadow-[0_0_12px_rgba(234,179,8,0.15)]"
                    : "border-border bg-secondary/30 hover:border-border/80",
                  !ativoManual && "opacity-60 cursor-not-allowed"
                )}
              >
                <div className={cn("w-10 h-10 rounded-full flex items-center justify-center shrink-0", paymentMethod === 'manual' ? "bg-yellow-500 text-black" : "bg-secondary text-foreground")}>
                  <Building2 className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-sm">Transferência Manual</h3>
                  <p className="text-xs text-muted-foreground" data-testid="manual-descricao">{ativoManual ? 'Envio de comprovativo (mais lento)' : configErro ? 'Não foi possível carregar os dados. Tenta mais tarde.' : config ? 'Indisponível de momento' : 'A carregar…'}</p>
                </div>
                <div className={cn("w-5 h-5 rounded-full border-2 flex items-center justify-center", paymentMethod === 'manual' ? "border-yellow-500 bg-yellow-500" : "border-muted")}>
                  {paymentMethod === 'manual' && <Check className="w-3 h-3 text-black" />}
                </div>
              </button>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-destructive text-xs mb-4 bg-destructive/10 p-2.5 rounded-lg">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setStep('amount')} disabled={loading}>
                Voltar
              </Button>
              <Button
                className="flex-1 h-12 font-bold bg-yellow-500 hover:bg-yellow-400 text-black rounded-xl"
                onClick={handleMethodContinue}
                disabled={loading}
              >
                {loading ? 'Aguarde...' : 'Continuar'}
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Step: GPO Phone Input ── */}
        {step === 'gpo_phone' && (
          <div className="p-6">
            <DialogHeader className="mb-6">
              <DialogTitle className="text-xl font-bold">Multicaixa Express</DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Introduz o número de telemóvel associado ao teu Multicaixa Express. Vais receber uma notificação para aprovar o pagamento.
              </p>
            </DialogHeader>

            <div className="mb-6">
              <label className="text-xs text-muted-foreground font-medium mb-1.5 block">Número de Telemóvel</label>
              <Input
                placeholder="Ex: 922 000 000"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, ''))}
                className="bg-secondary border-border"
                maxLength={15}
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-destructive text-xs mb-4 bg-destructive/10 p-2.5 rounded-lg">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setStep('method')} disabled={loading}>
                Voltar
              </Button>
              <Button
                className="flex-[2] h-12 font-bold bg-yellow-500 hover:bg-yellow-400 text-black rounded-xl"
                onClick={handleGpoSubmit}
                disabled={loading || phoneNumber.length < 9}
              >
                {loading ? 'A enviar pedido...' : `Pagar ${selectedAmount.toLocaleString('pt-PT')} Kz`}
              </Button>
            </div>
          </div>
        )}

        {/* ── Step: GPO Success ── */}
        {/* ── kursiPay (cobrança direta): telemóvel, à espera da aprovação, referência e concluído ── */}
        {step === 'kursipay_phone' && (
          <div className="p-6" data-testid="kursipay-phone">
            <DialogHeader className="mb-5">
              <DialogTitle className="text-xl font-bold">Multicaixa Express</DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Introduz o número de telemóvel associado ao teu Multicaixa Express. Vais receber um pedido para aprovar {selectedAmount.toLocaleString('pt-PT')} Kz. O número é usado apenas para este pagamento.
              </p>
            </DialogHeader>
            <div className="mb-6">
              <label className="text-xs text-muted-foreground font-medium mb-1.5 block">Número de Telemóvel</label>
              <Input
                placeholder="Ex: 923 456 789"
                inputMode="tel"
                autoComplete="tel"
                data-testid="kursipay-telefone"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value.replace(/[^\d+ ]/g, ''))}
                className="bg-secondary border-border"
                maxLength={17}
              />
            </div>
            {error && (
              <div className="flex items-center gap-2 text-destructive text-xs mb-4 bg-destructive/10 p-2.5 rounded-lg" data-testid="kursipay-erro">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 rounded-xl" onClick={() => { setError(''); setStep('method'); }} disabled={loading}>Voltar</Button>
              <Button
                className="flex-[2] h-12 font-bold bg-yellow-500 hover:bg-yellow-400 text-black rounded-xl"
                data-testid="kursipay-pagar"
                onClick={() => void handleKursipaySubmit('express')}
                disabled={loading || phoneNumber.replace(/\D/g, '').length < 9}
              >
                {loading ? 'A enviar pedido...' : `Pagar ${selectedAmount.toLocaleString('pt-PT')} Kz`}
              </Button>
            </div>
          </div>
        )}

        {step === 'kursipay_espera' && (
          <div className="p-8 flex flex-col items-center text-center" data-testid="kursipay-espera">
            <div className="w-20 h-20 rounded-full bg-yellow-500/15 border border-yellow-500/30 flex items-center justify-center mb-5">
              <Smartphone className={cn("w-10 h-10 text-yellow-700 dark:text-yellow-400", !kursipayPendente && "animate-pulse")} />
            </div>
            {!kursipayPendente ? (
              <>
                <h2 className="text-2xl font-bold mb-2">Aprova no teu telemóvel</h2>
                <p className="text-muted-foreground mb-6">
                  Enviámos um pedido de {selectedAmount.toLocaleString('pt-PT')} Kz para o teu Multicaixa Express. Abre a app e aprova o pagamento. O saldo é creditado automaticamente e este ecrã atualiza-se sozinho.
                </p>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-bold mb-2" data-testid="kursipay-ainda-pendente">Ainda pendente</h2>
                <p className="text-muted-foreground mb-6">
                  Ainda não recebemos a tua aprovação. Se já aprovaste, o saldo é creditado automaticamente assim que o pagamento for confirmado. Se não recebeste o pedido, fecha e tenta de novo.
                </p>
                <Button className="w-full h-12 mb-3 font-bold bg-yellow-500 hover:bg-yellow-400 text-black rounded-xl" data-testid="kursipay-verificar" onClick={() => setKursipayVerificar((n) => n + 1)}>Verificar agora</Button>
              </>
            )}
            <Button variant="outline" className="w-full rounded-xl" onClick={handleClose}>Fechar</Button>
          </div>
        )}

        {step === 'kursipay_hospedado' && (
          <div className="p-8 flex flex-col items-center text-center" data-testid="kursipay-hospedado">
            <div className="w-20 h-20 rounded-full bg-yellow-500/15 border border-yellow-500/30 flex items-center justify-center mb-5">
              <CreditCard className="w-10 h-10 text-yellow-700 dark:text-yellow-400 animate-pulse" />
            </div>
            <h2 className="text-2xl font-bold mb-2">A aguardar o pagamento</h2>
            <p className="text-muted-foreground mb-6">
              Conclui o pagamento de {selectedAmount.toLocaleString('pt-PT')} Kz na página que abriu. O saldo é creditado automaticamente quando o pagamento for confirmado.
            </p>
            <a href={kursipayUrl} target="_blank" rel="noopener noreferrer" data-testid="kursipay-abrir" className="w-full h-12 mb-3 inline-flex items-center justify-center font-bold rounded-xl bg-yellow-500 hover:bg-yellow-400 text-black">
              Abrir página de pagamento
            </a>
            <Button variant="outline" className="w-full rounded-xl" onClick={handleClose}>Fechar</Button>
          </div>
        )}

        {step === 'kursipay_ref' && kursipayRef && (
          <div className="p-6" data-testid="kursipay-ref">
            <DialogHeader className="mb-5">
              <div className="flex items-center gap-3 mb-1">
                <div className="w-10 h-10 rounded-full bg-yellow-500/15 flex items-center justify-center">
                  <Receipt className="w-5 h-5 text-yellow-700 dark:text-yellow-500" />
                </div>
                <DialogTitle className="text-xl font-bold">Referência Gerada</DialogTitle>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Paga a referência abaixo num ATM, no Multicaixa Express ou no teu Homebanking.
              </p>
            </DialogHeader>
            <div className="bg-secondary/60 border border-border rounded-xl p-5 space-y-4 mb-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold mb-1">Entidade</p>
                  <p className="text-lg font-bold font-mono tracking-widest" data-testid="kursipay-entidade">{kursipayRef.entidade}</p>
                </div>
                <Button variant="outline" size="icon" className="rounded-lg shrink-0" aria-label="Copiar entidade" data-testid="kursipay-copiar-entidade" onClick={() => copiar(kursipayRef.entidade, 'entidade')}>
                  {copiado === 'entidade' ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              <div className="h-px bg-border" />
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold mb-1">Referência</p>
                  <p className="text-xl font-bold font-mono tracking-widest text-primary" data-testid="kursipay-referencia">{kursipayRef.referencia.replace(/(.{3})/g, '$1 ').trim()}</p>
                </div>
                <Button variant="outline" size="icon" className="rounded-lg shrink-0" aria-label="Copiar referência" data-testid="kursipay-copiar-referencia" onClick={() => copiar(kursipayRef.referencia, 'referencia')}>
                  {copiado === 'referencia' ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              <div className="h-px bg-border" />
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold mb-1">Valor a Pagar</p>
                <p className="text-lg font-bold" data-testid="kursipay-valor">{kursipayRef.valor.toLocaleString('pt-PT')} Kz</p>
              </div>
              {kursipayRef.validaAte && (
                <>
                  <div className="h-px bg-border" />
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold mb-1">Válida até</p>
                    <p className="text-sm font-semibold" data-testid="kursipay-prazo">{new Date(kursipayRef.validaAte).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' })}</p>
                  </div>
                </>
              )}
            </div>
            <div className="w-full bg-secondary/60 border border-border rounded-xl p-4 mb-6">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Depois de pagares, o saldo entra <span className="font-semibold text-foreground">automaticamente</span> na tua carteira assim que o pagamento for confirmado. Não precisas de enviar comprovativo.
              </p>
            </div>
            <Button className="w-full h-12 font-bold rounded-xl" onClick={handleClose}>
              Entendi, já copiei os dados
            </Button>
          </div>
        )}

        {step === 'kursipay_ok' && (
          <div className="p-8 flex flex-col items-center text-center" data-testid="kursipay-ok">
            <div className="w-20 h-20 rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center mb-5">
              <CheckCircle2 className="w-10 h-10 text-green-500" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Pagamento confirmado</h2>
            <p className="text-muted-foreground mb-6">O saldo já está na tua carteira.</p>
            <Button className="w-full h-12 font-bold rounded-xl" onClick={handleClose}>Concluir</Button>
          </div>
        )}

        {step === 'gpo_success' && (
          <div className="p-8 flex flex-col items-center text-center">
            <div className="w-20 h-20 rounded-full bg-yellow-500/15 border border-yellow-500/30 flex items-center justify-center mb-5">
              <Smartphone className="w-10 h-10 text-yellow-700 dark:text-yellow-400 animate-pulse" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Verifica o teu telemóvel!</h2>
            <p className="text-muted-foreground mb-6">
              Enviamos um pedido de pagamento para o teu Multicaixa Express. 
              Abre a app no telemóvel e confirma a cobrança.
            </p>
            <div className="w-full bg-secondary/60 border border-border rounded-xl p-4 mb-6 text-left">
              <p className="text-xs text-muted-foreground leading-relaxed">
                <span className="font-semibold text-foreground">Atenção:</span><br />
                O saldo será creditado automaticamente na tua conta assim que aprovares o pagamento na app. Podes fechar esta janela com segurança.
              </p>
            </div>
            <Button className="w-full h-12 font-bold rounded-xl" onClick={handleClose}>
              Concluir
            </Button>
          </div>
        )}

        {/* ── Step: REF Success ── */}
        {step === 'ref_success' && refData && (
          <div className="p-6">
            <DialogHeader className="mb-5">
              <div className="flex items-center gap-3 mb-1">
                <div className="w-10 h-10 rounded-full bg-yellow-500/15 flex items-center justify-center">
                  <Receipt className="w-5 h-5 text-yellow-700 dark:text-yellow-500" />
                </div>
                <DialogTitle className="text-xl font-bold">Referência Gerada</DialogTitle>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Paga a referência abaixo num ATM ou através do teu Homebanking.
              </p>
            </DialogHeader>

            <div className="bg-secondary/60 border border-border rounded-xl p-5 space-y-4 mb-6">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold mb-1">Entidade</p>
                <p className="text-lg font-bold font-mono tracking-widest">{refData.entity}</p>
              </div>
              <div className="h-px bg-border" />
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold mb-1">Referência</p>
                <p className="text-xl font-bold font-mono tracking-widest text-primary">{refData.referenceNumber.replace(/(.{3})/g, '$1 ').trim()}</p>
              </div>
              <div className="h-px bg-border" />
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold mb-1">Valor a Pagar</p>
                <p className="text-lg font-bold">{selectedAmount.toLocaleString('pt-PT')} Kz</p>
              </div>
            </div>

            <div className="w-full bg-secondary/60 border border-border rounded-xl p-4 mb-6">
              <p className="text-xs text-muted-foreground leading-relaxed">
                O saldo será creditado <span className="font-semibold text-foreground">automaticamente</span> assim que o pagamento for confirmado pelo banco. 
                A referência é válida até {new Date(refData.dueDate).toLocaleDateString('pt-PT')}.
              </p>
            </div>

            <Button className="w-full h-12 font-bold rounded-xl" onClick={handleClose}>
              Entendi, já copiei os dados
            </Button>
          </div>
        )}

        {/* ── Step: Manual Transfer Instructions ── */}
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
                <p className="text-sm font-bold" data-testid="transfer-titular">{config?.manual.titular}</p>
              </div>
              <div className="h-px bg-border" />
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold mb-1">NIB</p>
                <div className="flex items-center justify-between gap-2">
                  <code className="text-sm font-bold font-mono tracking-wider" data-testid="transfer-nib">{config?.manual.nibFormatado}</code>
                  <button
                    onClick={copyIban}
                    className="shrink-0 p-1.5 rounded-lg bg-background border border-border hover:bg-secondary transition-colors"
                  >
                    {copiedIban ? <Check className="w-4 h-4 text-green-700 dark:text-green-500" /> : <Copy className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </div>
              </div>
              <div className="h-px bg-border" />
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold mb-1">Valor</p>
                <p className="text-sm font-bold">{selectedAmount.toLocaleString('pt-PT')} Kz</p>
              </div>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setStep('method')}>
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

        {/* ── Step: Manual PDF upload ── */}
        {step === 'confirm' && (
          <div className="p-6">
            <DialogHeader className="mb-5">
              <DialogTitle className="text-xl font-bold">Anexar Comprovativo</DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Anexa o comprovativo da transferência em PDF para verificação.
              </p>
            </DialogHeader>

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
                  <FileText className="w-5 h-5 text-green-700 dark:text-green-400 shrink-0" />
                  <span className="flex-1 text-sm font-medium truncate text-green-800 dark:text-green-300">{pdfName}</span>
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
                disabled={loading}
                onClick={handleConfirmManual}
              >
                {loading ? 'A enviar...' : 'Submeter pedido'}
              </Button>
            </div>
          </div>
        )}

        {/* ── Step: Manual Success ── */}
        {step === 'success' && (
          <div className="p-8 flex flex-col items-center text-center">
            <div className="w-20 h-20 rounded-full bg-yellow-500/15 border border-yellow-500/30 flex items-center justify-center mb-5">
              <CheckCircle2 className="w-10 h-10 text-yellow-700 dark:text-yellow-400" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Pedido enviado!</h2>
            <p className="text-muted-foreground mb-4">
              O teu pedido de carregamento de{' '}
              <span className="font-bold text-foreground">{selectedAmount.toLocaleString('pt-PT')} Kz</span>{' '}
              foi registado.
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
