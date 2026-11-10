import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, CheckCircle2, AlertTriangle, Loader2, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Estado = 'a_verificar' | 'sucesso' | 'invalido' | 'rede';

/** Confirmação do email com a ligação enviada por email (/verificar-email?token=…). O token sai do endereço assim que é lido. Funciona sem sessão. */
export default function VerificarEmail() {
  const [estado, setEstado] = useState<Estado>('a_verificar');
  const [token, setToken] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token');
    const limpo = t && t.trim() ? t.trim() : null;
    // O token não deve ficar no histórico nem seguir em cabeçalhos «Referer»: tira-se do endereço.
    if (t !== null) window.history.replaceState(null, '', window.location.pathname);
    if (limpo) setToken(limpo); else setEstado('invalido');
  }, []);

  useEffect(() => {
    if (!token) return;
    let vivo = true;
    setEstado('a_verificar');
    (async () => {
      try {
        const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
        const res = await fetch(`${base}/api/auth/verificar-email/confirmar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ token }) });
        if (!vivo) return;
        if (res.ok) setEstado('sucesso');
        else if (res.status === 400) setEstado('invalido');
        else setEstado('rede');
      } catch {
        if (vivo) setEstado('rede');
      }
    })();
    return () => { vivo = false; };
  }, [token, tentativa]);

  return (
    <main className="min-h-[100dvh] bg-background flex flex-col">
      <div className="p-6">
        <Link href="/home" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Voltar ao Xclusive
        </Link>
      </div>
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          {estado === 'a_verificar' && (
            <div data-testid="verificar-a-verificar" role="status">
              <Loader2 className="w-10 h-10 mx-auto mb-6 animate-spin text-primary" aria-hidden="true" />
              <h1 className="text-2xl font-bold mb-2">A confirmar o teu email…</h1>
            </div>
          )}
          {estado === 'sucesso' && (
            <div data-testid="verificar-sucesso">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6"><CheckCircle2 className="w-8 h-8 text-primary" aria-hidden="true" /></div>
              <h1 className="text-2xl font-bold mb-2">Email verificado</h1>
              <p className="text-muted-foreground mb-8">Obrigado! Já podes avançar para te tornares criador.</p>
              <Link href="/tornar-criador"><Button className="w-full h-12 bg-primary hover:bg-primary/90 text-white font-semibold">Continuar para ser criador</Button></Link>
            </div>
          )}
          {estado === 'invalido' && (
            <div data-testid="verificar-invalido">
              <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-6"><AlertTriangle className="w-8 h-8 text-destructive" aria-hidden="true" /></div>
              <h1 className="text-2xl font-bold mb-2">Ligação inválida ou expirada</h1>
              <p className="text-muted-foreground mb-8">Esta ligação já foi usada, expirou ou não está correta. Pede um novo email de verificação nas Definições.</p>
              <Link href="/definicoes"><Button className="w-full h-12 bg-primary hover:bg-primary/90 text-white font-semibold" data-testid="verificar-pedir-novo">Pedir novo email</Button></Link>
            </div>
          )}
          {estado === 'rede' && (
            <div data-testid="verificar-rede">
              <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-6"><WifiOff className="w-8 h-8 text-destructive" aria-hidden="true" /></div>
              <h1 className="text-2xl font-bold mb-2">Não foi possível confirmar</h1>
              <p className="text-muted-foreground mb-8">Houve um problema de ligação. A tua ligação continua válida: tenta novamente.</p>
              <Button className="w-full h-12 bg-primary hover:bg-primary/90 text-white font-semibold" onClick={() => setTentativa((n) => n + 1)} data-testid="verificar-tentar">Tentar novamente</Button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
