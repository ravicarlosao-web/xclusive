import { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { CameraCapture } from '@/components/shared/CameraCapture';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  Shield, ChevronLeft, ChevronRight, CheckCircle2, Star,
  BarChart3, BadgeCheck, Clock, AlertTriangle, Camera,
  FileText, ScanFace, ClipboardList, Sparkles, X,
  Eye, Loader2, RefreshCw, Info
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────
type Step = 'intro' | 'personal' | 'document' | 'selfie' | 'liveness' | 'review' | 'success';

interface KYCData {
  nomeCompleto: string;
  dataNascimento: string;
  tipoDocumento: 'bi' | 'passaporte' | 'carta';
  numeroDocumento: string;
  paisEmissao: string;
  documentoFoto: string | null;
  selfieFoto: string | null;
  livenessFoto: string | null;
  consentimento: boolean;
}

interface PersonalErrors {
  nomeCompleto?: string;
  dataNascimento?: string;
  numeroDocumento?: string;
  paisEmissao?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const STEP_ORDER: Step[] = ['intro', 'personal', 'document', 'selfie', 'liveness', 'review', 'success'];
const STEP_LABELS: Record<string, string> = {
  personal: 'Dados',
  document: 'Documento',
  selfie: 'Selfie',
  liveness: 'Presença',
  review: 'Revisão',
};

const DOC_TYPES = [
  { value: 'bi', label: 'Bilhete de Identidade' },
  { value: 'passaporte', label: 'Passaporte' },
  { value: 'carta', label: 'Carta de Condução' },
];

const PAISES = [
  'Angola', 'Moçambique', 'África do Sul', 'Portugal', 'Brasil',
  'Cabo Verde', 'São Tomé e Príncipe', 'Guiné-Bissau', 'Outro',
];

const LIVENESS_CHALLENGES = [
  { id: 1, text: 'Olha diretamente para a câmera', icon: '👁️', auto: true, delay: 2500 },
  { id: 2, text: 'Pisca os olhos devagar 2 vezes', icon: '😉', auto: false },
  { id: 3, text: 'Sorri naturalmente', icon: '😊', auto: false },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function calculateAge(dob: string): number {
  if (!dob) return 0;
  const today = new Date();
  const birth = new Date(dob);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

// ─── Progress Header ─────────────────────────────────────────────────────────
function StepProgress({ current }: { current: Step }) {
  const progressSteps = Object.keys(STEP_LABELS) as Step[];
  const currentIdx = progressSteps.indexOf(current);

  return (
    <div className="flex items-center justify-center gap-2">
      {progressSteps.map((step, idx) => {
        const done = currentIdx > idx;
        const active = currentIdx === idx;
        return (
          <div key={step} className="flex items-center gap-2">
            <div className="flex flex-col items-center gap-1">
              <div className={cn(
                'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300',
                done && 'bg-primary text-white',
                active && 'bg-primary/20 text-primary ring-2 ring-primary ring-offset-2 ring-offset-background animate-pulse',
                !done && !active && 'bg-secondary text-muted-foreground',
              )}>
                {done ? <CheckCircle2 className="w-4 h-4" /> : idx + 1}
              </div>
              <span className={cn('text-[10px] font-medium hidden sm:block', active ? 'text-primary' : done ? 'text-muted-foreground' : 'text-muted-foreground/50')}>
                {STEP_LABELS[step]}
              </span>
            </div>
            {idx < progressSteps.length - 1 && (
              <div className={cn('w-8 sm:w-12 h-0.5 transition-all duration-500 mt-[-14px]', done ? 'bg-primary' : 'bg-border')} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function KYCPage() {
  const { user, updateTipoConta, isMockMode } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>('intro');
  const [submitting, setSubmitting] = useState(false);
  const [livenessChallenge, setLivenessChallenge] = useState(0);
  const [livenesDone, setLivenessDone] = useState(false);
  const [captureSignal, setCaptureSignal] = useState(0);
  const livenessChallengeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [data, setData] = useState<KYCData>({
    nomeCompleto: user?.nomeExibicao ?? '',
    dataNascimento: '',
    tipoDocumento: 'bi',
    numeroDocumento: '',
    paisEmissao: 'Angola',
    documentoFoto: null,
    selfieFoto: null,
    livenessFoto: null,
    consentimento: false,
  });

  const [errors, setErrors] = useState<PersonalErrors>({});

  // Cleanup liveness timer on unmount
  useEffect(() => () => { if (livenessChallengeTimer.current) clearTimeout(livenessChallengeTimer.current); }, []);

  const goTo = (s: Step) => {
    setStep(s);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // ── Personal Validation ──────────────────────────────────────────────────
  const validatePersonal = (): boolean => {
    const e: PersonalErrors = {};
    if (!data.nomeCompleto.trim() || data.nomeCompleto.trim().split(' ').length < 2)
      e.nomeCompleto = 'Insere o teu nome completo (nome e apelido).';
    if (!data.dataNascimento)
      e.dataNascimento = 'Insere a tua data de nascimento.';
    else if (calculateAge(data.dataNascimento) < 18)
      e.dataNascimento = 'Tens de ter pelo menos 18 anos para te tornares criador.';
    if (!data.numeroDocumento.trim())
      e.numeroDocumento = 'Insere o número do documento.';
    if (!data.paisEmissao)
      e.paisEmissao = 'Seleciona o país de emissão.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // ── Liveness flow ────────────────────────────────────────────────────────
  const advanceLiveness = (from: number) => {
    if (from + 1 >= LIVENESS_CHALLENGES.length) {
      setLivenessDone(true);
      setCaptureSignal(s => s + 1);
    } else {
      setLivenessChallenge(from + 1);
    }
  };

  const startLiveness = () => {
    setLivenessChallenge(0);
    setLivenessDone(false);
    livenessChallengeTimer.current = setTimeout(() => {
      advanceLiveness(0);
    }, LIVENESS_CHALLENGES[0].delay);
  };

  useEffect(() => {
    if (step === 'liveness') startLiveness();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // ── Submit ───────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!data.consentimento) {
      toast({ variant: 'destructive', title: 'Consentimento necessário', description: 'Confirma que as informações são verdadeiras.' });
      return;
    }
    setSubmitting(true);
    try {
      // Store KYC submission in localStorage
      const submission = {
        userId: user?.id,
        username: user?.username,
        ...data,
        documentoFoto: '[captured]',
        selfieFoto: '[captured]',
        livenessFoto: '[captured]',
        submittedAt: new Date().toISOString(),
        status: 'pending',
      };
      const existing = JSON.parse(localStorage.getItem('xclusive_kyc_submissions') || '[]');
      localStorage.setItem('xclusive_kyc_submissions', JSON.stringify([submission, ...existing]));

      // Mock/offline mode: immediate approval (no real backend)
      // In production with a real API, the backend would review the submission and call updateTipoConta on webhook
      if (isMockMode) {
        await new Promise(r => setTimeout(r, 2200)); // simulate processing
        updateTipoConta('criador');
      } else {
        // Real mode: submission is queued for manual/automated review — don't auto-promote
        await new Promise(r => setTimeout(r, 1500));
      }

      goTo('success');
    } catch {
      toast({ variant: 'destructive', title: 'Erro ao enviar', description: 'Tenta novamente.' });
    } finally {
      setSubmitting(false);
    }
  };

  const showProgress = step !== 'intro' && step !== 'success';

  // ──────────────────────────────────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex flex-col">
      {/* ── Header ── */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b border-border">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center justify-between gap-4">
          {step !== 'intro' && step !== 'success' ? (
            <Button variant="ghost" size="icon" className="shrink-0" onClick={() => {
              const idx = STEP_ORDER.indexOf(step);
              goTo(STEP_ORDER[Math.max(0, idx - 1)]);
            }}>
              <ChevronLeft className="w-5 h-5" />
            </Button>
          ) : (
            <Link href={user ? `/perfil/${user.username}` : '/home'}>
              <Button variant="ghost" size="icon" className="shrink-0">
                <X className="w-5 h-5" />
              </Button>
            </Link>
          )}

          <div className="flex-1 flex flex-col items-center">
            {showProgress ? (
              <StepProgress current={step} />
            ) : (
              <span className="text-sm font-semibold text-foreground">Verificação de Identidade</span>
            )}
          </div>

          {/* Placeholder for symmetry */}
          <div className="w-9" />
        </div>
      </header>

      {/* ── Content ── */}
      <div className="flex-1 max-w-lg mx-auto w-full px-4 py-6 pb-28">

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* INTRO */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {step === 'intro' && (
          <div className="space-y-6 animate-in fade-in-0 slide-in-from-bottom-4 duration-400">
            {/* Hero */}
            <div className="text-center space-y-3 pt-2">
              <div className="mx-auto w-20 h-20 rounded-3xl bg-gradient-to-br from-primary/30 to-primary/5 border border-primary/20 flex items-center justify-center shadow-[0_0_40px_rgba(255,62,114,0.15)]">
                <Shield className="w-10 h-10 text-primary" />
              </div>
              <div>
                <h1 className="text-3xl font-extrabold tracking-tight">Torna-te Criador</h1>
                <p className="text-muted-foreground mt-1.5">Verifica a tua identidade para desbloquear todas as ferramentas de monetização.</p>
              </div>
            </div>

            {/* Benefits */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { icon: '💰', title: 'Monetiza', sub: 'Conteúdo exclusivo' },
                { icon: '📊', title: 'Analytics', sub: 'Ganhos em tempo real' },
                { icon: '✅', title: 'Verificado', sub: 'Selo de criador' },
              ].map(b => (
                <div key={b.title} className="bg-secondary/50 border border-border rounded-2xl p-3 text-center space-y-1">
                  <div className="text-2xl">{b.icon}</div>
                  <div className="text-xs font-bold text-foreground">{b.title}</div>
                  <div className="text-[10px] text-muted-foreground leading-tight">{b.sub}</div>
                </div>
              ))}
            </div>

            {/* Requirements */}
            <div className="bg-secondary/40 border border-border rounded-2xl p-5 space-y-3">
              <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                <ClipboardList className="w-4 h-4 text-primary" /> O que precisas
              </p>
              {[
                'BI, Passaporte ou Carta de Condução válido',
                'Ter 18 ou mais anos de idade',
                'Dispositivo com câmera frontal e traseira',
                'Boa iluminação no ambiente',
              ].map(req => (
                <div key={req} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                  <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  {req}
                </div>
              ))}
            </div>

            {/* Important notice */}
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-200/80 space-y-1">
                <p className="font-semibold text-amber-300">Informação importante</p>
                <p>As tuas informações são processadas de forma segura e nunca partilhadas com terceiros. O processo leva cerca de <strong>5 minutos</strong>.</p>
              </div>
            </div>

            <Button
              onClick={() => goTo('personal')}
              className="w-full h-13 text-base font-bold bg-primary hover:bg-primary/90 text-white rounded-2xl shadow-[0_0_30px_rgba(255,62,114,0.25)] gap-2"
            >
              Começar Verificação <ChevronRight className="w-5 h-5" />
            </Button>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* PERSONAL DATA */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {step === 'personal' && (
          <div className="space-y-5 animate-in fade-in-0 slide-in-from-right-4 duration-300">
            <div>
              <h2 className="text-xl font-bold">Os teus dados pessoais</h2>
              <p className="text-sm text-muted-foreground mt-1">Deve corresponder exatamente ao teu documento de identidade.</p>
            </div>

            {/* Nome completo */}
            <div className="space-y-1.5">
              <Label htmlFor="nome">Nome Completo</Label>
              <Input
                id="nome"
                placeholder="Ex: João Manuel Silva"
                value={data.nomeCompleto}
                onChange={e => setData(d => ({ ...d, nomeCompleto: e.target.value }))}
                className={cn('h-12 bg-secondary/50', errors.nomeCompleto && 'border-destructive')}
              />
              {errors.nomeCompleto && <p className="text-destructive text-xs flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{errors.nomeCompleto}</p>}
            </div>

            {/* Data de nascimento */}
            <div className="space-y-1.5">
              <Label htmlFor="dob">Data de Nascimento</Label>
              <Input
                id="dob"
                type="date"
                max={new Date(new Date().setFullYear(new Date().getFullYear() - 18)).toISOString().split('T')[0]}
                value={data.dataNascimento}
                onChange={e => setData(d => ({ ...d, dataNascimento: e.target.value }))}
                className={cn('h-12 bg-secondary/50', errors.dataNascimento && 'border-destructive')}
              />
              {errors.dataNascimento ? (
                <p className="text-destructive text-xs flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{errors.dataNascimento}</p>
              ) : data.dataNascimento && (
                <p className="text-muted-foreground text-xs flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-green-500" />
                  {calculateAge(data.dataNascimento)} anos — elegível ✓
                </p>
              )}
            </div>

            {/* Tipo de documento */}
            <div className="space-y-1.5">
              <Label>Tipo de Documento</Label>
              <div className="grid grid-cols-3 gap-2">
                {DOC_TYPES.map(dt => (
                  <button
                    key={dt.value}
                    onClick={() => setData(d => ({ ...d, tipoDocumento: dt.value as KYCData['tipoDocumento'] }))}
                    className={cn(
                      'p-3 rounded-xl border text-xs font-semibold text-center transition-all',
                      data.tipoDocumento === dt.value
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-secondary/40 text-muted-foreground hover:border-primary/50',
                    )}
                  >
                    {dt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Número do documento */}
            <div className="space-y-1.5">
              <Label htmlFor="doc-num">Número do {DOC_TYPES.find(d => d.value === data.tipoDocumento)?.label}</Label>
              <Input
                id="doc-num"
                placeholder={data.tipoDocumento === 'bi' ? 'Ex: 005423789LA012' : data.tipoDocumento === 'passaporte' ? 'Ex: N1234567' : 'Ex: L.LD.000123'}
                value={data.numeroDocumento}
                onChange={e => setData(d => ({ ...d, numeroDocumento: e.target.value.toUpperCase() }))}
                className={cn('h-12 bg-secondary/50 font-mono tracking-wide', errors.numeroDocumento && 'border-destructive')}
              />
              {errors.numeroDocumento && <p className="text-destructive text-xs flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{errors.numeroDocumento}</p>}
            </div>

            {/* País de emissão */}
            <div className="space-y-1.5">
              <Label htmlFor="pais">País de Emissão</Label>
              <select
                id="pais"
                value={data.paisEmissao}
                onChange={e => setData(d => ({ ...d, paisEmissao: e.target.value }))}
                className={cn(
                  'w-full h-12 bg-secondary/50 border border-input rounded-xl px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring',
                  errors.paisEmissao && 'border-destructive',
                )}
              >
                {PAISES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              {errors.paisEmissao && <p className="text-destructive text-xs flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{errors.paisEmissao}</p>}
            </div>

            {/* Privacy note */}
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 flex gap-2">
              <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <p className="text-xs text-blue-300/80">Os teus dados são encriptados e armazenados de forma segura, sendo usados apenas para verificação de identidade.</p>
            </div>

            <Button
              onClick={() => { if (validatePersonal()) goTo('document'); }}
              className="w-full h-13 font-bold bg-primary hover:bg-primary/90 text-white rounded-2xl gap-2"
            >
              Continuar <ChevronRight className="w-5 h-5" />
            </Button>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* DOCUMENT PHOTO */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {step === 'document' && (
          <div className="space-y-5 animate-in fade-in-0 slide-in-from-right-4 duration-300">
            <div>
              <h2 className="text-xl font-bold">Foto do documento</h2>
              <p className="text-sm text-muted-foreground mt-1">Fotografa a frente do teu {DOC_TYPES.find(d => d.value === data.tipoDocumento)?.label.toLowerCase()} com a câmera traseira.</p>
            </div>

            {/* Tips */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { icon: '💡', text: 'Boa iluminação' },
                { icon: '🔍', text: 'Dados legíveis' },
                { icon: '📐', text: 'Documento plano' },
                { icon: '🚫', text: 'Sem reflexos' },
              ].map(t => (
                <div key={t.text} className="flex items-center gap-2 bg-secondary/40 rounded-xl px-3 py-2.5 text-xs text-muted-foreground">
                  <span>{t.icon}</span> {t.text}
                </div>
              ))}
            </div>

            {/* Camera */}
            <CameraCapture
              facingMode="environment"
              overlay="document"
              onCapture={(url) => setData(d => ({ ...d, documentoFoto: url }))}
              className="aspect-[4/3] w-full"
            />

            <Button
              onClick={() => goTo('selfie')}
              disabled={!data.documentoFoto}
              className="w-full h-13 font-bold bg-primary hover:bg-primary/90 text-white rounded-2xl disabled:opacity-40 gap-2"
            >
              {data.documentoFoto ? <><CheckCircle2 className="w-5 h-5" /> Continuar</> : <><Camera className="w-5 h-5" /> Tira a foto para continuar</>}
            </Button>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* SELFIE WITH DOCUMENT */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {step === 'selfie' && (
          <div className="space-y-5 animate-in fade-in-0 slide-in-from-right-4 duration-300">
            <div>
              <h2 className="text-xl font-bold">Selfie com o documento</h2>
              <p className="text-sm text-muted-foreground mt-1">Segura o documento junto ao teu rosto. Ambos devem estar visíveis e nítidos.</p>
            </div>

            {/* Tips */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { icon: '🤳', text: 'Câmera frontal' },
                { icon: '📄', text: 'Segura o BI na mão' },
                { icon: '👁️', text: 'Olhos visíveis' },
                { icon: '💡', text: 'Luz natural' },
              ].map(t => (
                <div key={t.text} className="flex items-center gap-2 bg-secondary/40 rounded-xl px-3 py-2.5 text-xs text-muted-foreground">
                  <span>{t.icon}</span> {t.text}
                </div>
              ))}
            </div>

            <CameraCapture
              facingMode="user"
              overlay="face-document"
              onCapture={(url) => setData(d => ({ ...d, selfieFoto: url }))}
              className="aspect-[3/4] w-full max-h-[420px] mx-auto"
            />

            <Button
              onClick={() => goTo('liveness')}
              disabled={!data.selfieFoto}
              className="w-full h-13 font-bold bg-primary hover:bg-primary/90 text-white rounded-2xl disabled:opacity-40 gap-2"
            >
              {data.selfieFoto ? <><CheckCircle2 className="w-5 h-5" /> Continuar</> : <><Camera className="w-5 h-5" /> Tira a foto para continuar</>}
            </Button>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* LIVENESS CHECK */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {step === 'liveness' && (
          <div className="space-y-5 animate-in fade-in-0 slide-in-from-right-4 duration-300">
            <div>
              <h2 className="text-xl font-bold">Prova que és real</h2>
              <p className="text-sm text-muted-foreground mt-1">Segue os desafios em tempo real. <strong className="text-foreground">Não são aceites gravações nem fotos.</strong></p>
            </div>

            {/* Challenge indicator */}
            <div className="bg-secondary/60 border border-border rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Desafio {Math.min(livenessChallenge + 1, LIVENESS_CHALLENGES.length)} de {LIVENESS_CHALLENGES.length}</span>
                <div className="flex gap-1.5">
                  {LIVENESS_CHALLENGES.map((_, i) => (
                    <div key={i} className={cn('w-2 h-2 rounded-full transition-all', i < livenessChallenge ? 'bg-green-500' : i === livenessChallenge ? 'bg-primary animate-pulse' : 'bg-border')} />
                  ))}
                </div>
              </div>
              {!livenesDone ? (
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{LIVENESS_CHALLENGES[livenessChallenge]?.icon}</span>
                  <div>
                    <p className="font-semibold text-white">{LIVENESS_CHALLENGES[livenessChallenge]?.text}</p>
                    {LIVENESS_CHALLENGES[livenessChallenge]?.auto && (
                      <p className="text-xs text-muted-foreground">A verificar automaticamente…</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-8 h-8 text-green-500" />
                  <div>
                    <p className="font-semibold text-green-400">Verificação concluída!</p>
                    <p className="text-xs text-muted-foreground">A capturar frame…</p>
                  </div>
                </div>
              )}
              <Progress value={((livenessChallenge) / LIVENESS_CHALLENGES.length) * 100} className="h-1.5" />
            </div>

            {/* Camera (face only, no capture button) */}
            <div className="relative">
              <CameraCapture
                facingMode="user"
                overlay="face"
                onCapture={(url) => {
                  setData(d => ({ ...d, livenessFoto: url }));
                  setTimeout(() => goTo('review'), 600);
                }}
                manualMode
                captureSignal={captureSignal}
                className="aspect-[3/4] w-full max-h-[380px] mx-auto"
              />
            </div>

            {/* Manual challenge button for non-auto challenges */}
            {!livenesDone && !LIVENESS_CHALLENGES[livenessChallenge]?.auto && (
              <Button
                onClick={() => advanceLiveness(livenessChallenge)}
                variant="outline"
                className="w-full h-13 font-bold rounded-2xl border-primary/50 text-primary hover:bg-primary/10 gap-2"
              >
                <CheckCircle2 className="w-5 h-5" /> Feito
              </Button>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* REVIEW */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {step === 'review' && (
          <div className="space-y-5 animate-in fade-in-0 slide-in-from-right-4 duration-300">
            <div>
              <h2 className="text-xl font-bold">Revisão final</h2>
              <p className="text-sm text-muted-foreground mt-1">Confirma os teus dados antes de submeter o pedido.</p>
            </div>

            {/* Data summary */}
            <div className="bg-secondary/40 border border-border rounded-2xl overflow-hidden divide-y divide-border">
              <div className="px-4 py-3 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Nome Completo</span>
                <span className="text-sm font-semibold text-foreground text-right max-w-[55%] truncate">{data.nomeCompleto}</span>
              </div>
              <div className="px-4 py-3 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Data de Nascimento</span>
                <span className="text-sm font-semibold text-foreground">{new Date(data.dataNascimento + 'T12:00:00').toLocaleDateString('pt-PT')} <Badge variant="outline" className="text-[10px] ml-1 text-green-400 border-green-400/40">{calculateAge(data.dataNascimento)} anos</Badge></span>
              </div>
              <div className="px-4 py-3 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Tipo de Doc.</span>
                <span className="text-sm font-semibold text-foreground">{DOC_TYPES.find(d => d.value === data.tipoDocumento)?.label}</span>
              </div>
              <div className="px-4 py-3 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Nº Documento</span>
                <span className="text-sm font-mono font-semibold text-foreground tracking-wider">{data.numeroDocumento}</span>
              </div>
              <div className="px-4 py-3 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">País de Emissão</span>
                <span className="text-sm font-semibold text-foreground">{data.paisEmissao}</span>
              </div>
            </div>

            {/* Photo previews */}
            <div className="space-y-2">
              <p className="text-sm font-semibold">Fotos capturadas</p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Documento', url: data.documentoFoto, ok: !!data.documentoFoto },
                  { label: 'Selfie', url: data.selfieFoto, ok: !!data.selfieFoto },
                  { label: 'Presença', url: data.livenessFoto, ok: !!data.livenessFoto },
                ].map(p => (
                  <div key={p.label} className="relative rounded-xl overflow-hidden bg-secondary aspect-square">
                    {p.url ? (
                      <>
                        <img src={p.url} alt={p.label} className="w-full h-full object-cover" style={{ transform: p.label !== 'Documento' ? 'scaleX(-1)' : 'none' }} />
                        <div className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[10px] font-semibold text-center py-1">{p.label}</div>
                        <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                          <CheckCircle2 className="w-3 h-3 text-white" />
                        </div>
                      </>
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-1">
                        <AlertTriangle className="w-5 h-5 text-destructive" />
                        <span className="text-[10px] text-destructive">{p.label}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Warning */}
            <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4 flex gap-3">
              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-300/80">Documentos falsos ou informações incorretas resultam em <strong className="text-red-300">banimento permanente</strong> da plataforma e possível ação legal.</p>
            </div>

            {/* Consent */}
            <div
              className="flex items-start gap-3 bg-secondary/40 border border-border rounded-2xl p-4 cursor-pointer"
              onClick={() => setData(d => ({ ...d, consentimento: !d.consentimento }))}
            >
              <Checkbox checked={data.consentimento} className="mt-0.5 shrink-0" onCheckedChange={(v) => setData(d => ({ ...d, consentimento: !!v }))} />
              <p className="text-sm text-muted-foreground leading-relaxed select-none">
                Confirmo que as informações fornecidas são <strong className="text-foreground">verdadeiras e precisas</strong>, que o documento é válido, e que tenho 18 ou mais anos de idade. Autorizo a Xclusive a processar os meus dados para fins de verificação de identidade.
              </p>
            </div>

            <Button
              onClick={handleSubmit}
              disabled={!data.consentimento || submitting}
              className="w-full h-13 font-bold bg-primary hover:bg-primary/90 text-white rounded-2xl disabled:opacity-40 gap-2"
            >
              {submitting ? (
                <><Loader2 className="w-5 h-5 animate-spin" /> A submeter…</>
              ) : (
                <><Shield className="w-5 h-5" /> Submeter Pedido</>
              )}
            </Button>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* SUCCESS */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {step === 'success' && (
          <div className="flex flex-col items-center text-center gap-6 pt-6 animate-in fade-in-0 zoom-in-95 duration-500">
            {/* Animated checkmark */}
            <div className="relative">
              <div className="w-28 h-28 rounded-full bg-gradient-to-br from-primary/30 to-green-500/20 border-2 border-green-500/40 flex items-center justify-center shadow-[0_0_60px_rgba(34,197,94,0.2)]">
                <CheckCircle2 className="w-14 h-14 text-green-400" />
              </div>
              <div className="absolute -top-1 -right-1 w-8 h-8 rounded-full bg-primary flex items-center justify-center border-2 border-background">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl font-extrabold">Verificação enviada!</h2>
              <p className="text-muted-foreground max-w-xs mx-auto">A tua conta de criador foi ativada. Podes começar a publicar conteúdo exclusivo já.</p>
            </div>

            {/* Timeline */}
            <div className="w-full max-w-xs space-y-0">
              {[
                { label: 'Dados submetidos', done: true, active: false },
                { label: 'Identidade verificada', done: true, active: false },
                { label: 'Conta de criador ativada', done: true, active: false },
              ].map((item, i) => (
                <div key={i} className="flex gap-3 items-start">
                  <div className="flex flex-col items-center">
                    <div className={cn('w-7 h-7 rounded-full flex items-center justify-center shrink-0',
                      item.done ? 'bg-green-500/20 border-2 border-green-500' : 'bg-secondary border-2 border-border',
                    )}>
                      {item.done && <CheckCircle2 className="w-4 h-4 text-green-400" />}
                    </div>
                    {i < 2 && <div className="w-0.5 h-6 bg-green-500/40" />}
                  </div>
                  <p className={cn('text-sm mt-1', item.done ? 'text-foreground font-medium' : 'text-muted-foreground')}>{item.label}</p>
                </div>
              ))}
            </div>

            {/* Mock mode note */}
            {isMockMode && (
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-4 text-left flex gap-2 w-full">
                <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <p className="text-xs text-blue-300/80">Em modo de demonstração, a tua conta de criador foi ativada imediatamente. Em produção, a verificação demora até 24 horas.</p>
              </div>
            )}

            <div className="flex flex-col gap-3 w-full">
              <Button
                onClick={() => setLocation(user ? `/perfil/${user.username}` : '/home')}
                className="w-full h-13 font-bold bg-primary hover:bg-primary/90 text-white rounded-2xl gap-2"
              >
                <BadgeCheck className="w-5 h-5" /> Ver o meu perfil de criador
              </Button>
              <Button
                onClick={() => setLocation('/definicoes/monetizacao')}
                variant="outline"
                className="w-full h-13 font-bold rounded-2xl"
              >
                <BarChart3 className="w-5 h-5 mr-2" /> Ir para o Painel Criador
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
