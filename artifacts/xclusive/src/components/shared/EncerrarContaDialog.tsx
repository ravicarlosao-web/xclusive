import { useEffect, useState } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';

/** Marca (por sessão do browser) de que a conta foi encerrada; o ecrã de login mostra o aviso (ver pages/login.tsx). */
export const CHAVE_CONTA_ENCERRADA = 'xclusive_conta_encerrada';

type Bloqueio = { codigo: string; mensagem: string };
type Estado = { podeEncerrar: boolean; bloqueios: Bloqueio[]; janelaDias: number };
type Passo = 1 | 2 | 3;

const base = () => (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
const cabecalhos = (): Record<string, string> => {
  const token = localStorage.getItem('xclusive_token');
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
};

/**
 * Encerrar a própria conta, em 3 passos: (1) o que acontece e o que impede o encerramento, (2) password e confirmação,
 * (3) resultado. Só chama a API real (nunca no modo de demonstração).
 */
export function EncerrarContaDialog({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const { user, logout } = useAuth();
  const [passo, setPasso] = useState<Passo>(1);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [erroCarregar, setErroCarregar] = useState(false);
  const [password, setPassword] = useState('');
  const [percebo, setPercebo] = useState(false);
  const [aEnviar, setAEnviar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [bloqueiosPost, setBloqueiosPost] = useState<Bloqueio[]>([]);
  const [mensagemFinal, setMensagemFinal] = useState('');
  const eCriadora = user?.tipoConta === 'criador';

  useEffect(() => {
    if (!aberto) return;
    setPasso(1); setEstado(null); setErroCarregar(false); setPassword(''); setPercebo(false); setErro(null); setBloqueiosPost([]);
    let vivo = true;
    fetch(`${base()}/api/users/me/encerramento`, { headers: cabecalhos(), credentials: 'same-origin' })
      .then(async (r) => { if (!r.ok) throw new Error(); const j = (await r.json()) as Estado; if (vivo) setEstado(j); })
      .catch(() => { if (vivo) setErroCarregar(true); });
    return () => { vivo = false; };
  }, [aberto]);

  const bloqueios = bloqueiosPost.length > 0 ? bloqueiosPost : estado?.bloqueios ?? [];

  const encerrar = async () => {
    setAEnviar(true); setErro(null);
    try {
      const r = await fetch(`${base()}/api/users/me/encerrar`, { method: 'POST', headers: cabecalhos(), credentials: 'same-origin', body: JSON.stringify({ password }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        const msg = typeof j?.mensagem === 'string' ? j.mensagem : 'A tua conta foi encerrada.';
        try { sessionStorage.setItem(CHAVE_CONTA_ENCERRADA, msg); } catch { /* sem armazenamento */ }
        setMensagemFinal(msg); setPasso(3);
        return;
      }
      if (r.status === 409 && Array.isArray(j?.bloqueios)) { setBloqueiosPost(j.bloqueios); setPasso(1); return; }
      if (r.status === 403 && j?.codigo === 'password_incorreta') { setErro('A password está incorreta. Tenta novamente.'); return; }
      setErro(typeof j?.error === 'string' ? j.error : 'Não foi possível encerrar a conta. Tenta novamente.');
    } catch {
      setErro('Não foi possível ligar ao servidor. Verifica a tua ligação e tenta novamente.');
    } finally {
      setAEnviar(false);
    }
  };

  // Depois de encerrada a sessão já não é válida: termina-a localmente e segue para o início de sessão.
  const concluir = () => { onFechar(); void logout(); };

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) { if (passo === 3) concluir(); else onFechar(); } }}>
      <DialogContent className="max-w-lg" data-testid="encerrar-dialogo">
        {passo === 1 && (
          <div data-testid="encerrar-passo-1" className="space-y-4">
            <DialogHeader>
              <DialogTitle>Encerrar a tua conta</DialogTitle>
              <DialogDescription>Passo 1 de 2: o que acontece.</DialogDescription>
            </DialogHeader>
            <ul className="list-disc pl-5 space-y-2 text-sm text-muted-foreground">
              <li>A tua conta fica inacessível e invisível de imediato, e a tua sessão termina em todos os dispositivos.</li>
              <li>Os dados que a lei obriga a conservar (transações, verificação de identidade, aceites, denúncias e registos de segurança) ficam retidos.</li>
              <li>O restante fica marcado para apagamento ao fim de {estado?.janelaDias ?? 30} dias. Durante esse prazo podes pedir a reabertura à equipa.</li>
              <li>As tuas subscrições são canceladas, sem reembolso.{eCriadora ? ' As subscrições dos teus subscritores também são canceladas e eles são avisados.' : ''}</li>
            </ul>
            {!estado && !erroCarregar && <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> A verificar a tua conta…</p>}
            {erroCarregar && <p role="alert" className="text-sm text-destructive" data-testid="encerrar-erro-carregar">Não foi possível verificar a tua conta. Tenta novamente daqui a pouco.</p>}
            {bloqueios.length > 0 && (
              <div role="alert" data-testid="encerrar-bloqueios" className="rounded-xl border border-destructive/50 bg-destructive/10 p-4 text-sm space-y-2">
                <p className="font-semibold flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Ainda não podes encerrar a conta:</p>
                <ul className="list-disc pl-5 space-y-1">
                  {bloqueios.map((b) => <li key={b.codigo} data-testid={`encerrar-bloqueio-${b.codigo}`}>{b.mensagem}</li>)}
                </ul>
              </div>
            )}
            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" onClick={onFechar} className="min-h-[44px]">Cancelar</Button>
              <Button variant="destructive" disabled={!estado || bloqueios.length > 0} onClick={() => setPasso(2)} className="min-h-[44px] dark:bg-red-700 dark:hover:bg-red-800 dark:text-white" data-testid="encerrar-continuar">Continuar</Button>
            </DialogFooter>
          </div>
        )}

        {passo === 2 && (
          <div data-testid="encerrar-passo-2" className="space-y-4">
            <DialogHeader>
              <DialogTitle>Confirma que queres encerrar</DialogTitle>
              <DialogDescription>Passo 2 de 2: confirma com a tua password.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="encerrar-password">Password</Label>
              <Input id="encerrar-password" data-testid="encerrar-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="flex items-start gap-3">
              <Checkbox id="encerrar-percebo" data-testid="encerrar-percebo" checked={percebo} onCheckedChange={(v) => setPercebo(v === true)} className="mt-0.5" />
              <Label htmlFor="encerrar-percebo" className="text-sm font-normal text-muted-foreground leading-relaxed">Percebo que perco o acesso à conta e ao conteúdo.</Label>
            </div>
            {erro && <p role="alert" data-testid="encerrar-erro" className="text-sm text-destructive">{erro}</p>}
            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" onClick={() => setPasso(1)} disabled={aEnviar} className="min-h-[44px]">Voltar</Button>
              <Button variant="destructive" onClick={encerrar} disabled={aEnviar || password.length === 0 || !percebo} className="min-h-[44px] dark:bg-red-700 dark:hover:bg-red-800 dark:text-white" data-testid="encerrar-confirmar">
                {aEnviar ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> A encerrar…</> : 'Encerrar a minha conta'}
              </Button>
            </DialogFooter>
          </div>
        )}

        {passo === 3 && (
          <div data-testid="encerrar-passo-3" className="space-y-4">
            <DialogHeader>
              <DialogTitle>Conta encerrada</DialogTitle>
              <DialogDescription data-testid="encerrar-mensagem-final">{mensagemFinal}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={concluir} className="min-h-[44px] dark:bg-[hsl(344_90%_42%)] dark:hover:bg-[hsl(344_90%_36%)] dark:text-white" data-testid="encerrar-concluir">Ir para o início de sessão</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
