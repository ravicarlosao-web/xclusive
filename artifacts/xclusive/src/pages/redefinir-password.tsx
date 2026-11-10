import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, KeyRound, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RodapeLegal } from '@/components/shared/RodapeLegal';

/** Redefinir a palavra-passe com a ligação enviada por email (/redefinir-password?token=…). O token sai do endereço assim que é lido. */
export default function RedefinirPassword() {
  const [token, setToken] = useState<string | null>(null);
  const [pronto, setPronto] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [tokenInvalido, setTokenInvalido] = useState(false);
  const [aEnviar, setAEnviar] = useState(false);
  const [feito, setFeito] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token');
    setToken(t && t.trim() ? t.trim() : null);
    // O token não deve ficar no histórico nem seguir em cabeçalhos «Referer»: tira-se do endereço.
    if (t) window.history.replaceState(null, '', window.location.pathname);
    setPronto(true);
  }, []);

  const submeter = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    if (password.length < 8) { setErro('A palavra-passe deve ter pelo menos 8 caracteres.'); return; }
    if (password.length > 128) { setErro('A palavra-passe pode ter no máximo 128 caracteres.'); return; }
    if (password !== confirmar) { setErro('As palavras-passe não coincidem.'); return; }
    setAEnviar(true);
    try {
      const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
      const res = await fetch(`${base}/api/auth/redefinir-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ token, password }),
      });
      if (res.ok) { setFeito(true); return; }
      const j = await res.json().catch(() => null);
      if (res.status === 400 && j?.codigo === 'token_invalido') { setTokenInvalido(true); return; }
      if (res.status === 400) { setErro(j?.details?.[0]?.mensagem ?? 'A palavra-passe não é válida.'); return; }
      if (res.status === 429) { setErro('Demasiadas tentativas. Tenta novamente dentro de 15 minutos.'); return; }
      setErro('Não foi possível redefinir a palavra-passe. Tenta novamente.');
    } catch {
      setErro('Não foi possível contactar o servidor. Tenta novamente.');
    } finally {
      setAEnviar(false);
    }
  };

  const invalido = pronto && (!token || tokenInvalido);

  return (
    <main className="min-h-[100dvh] bg-background flex flex-col">
      <div className="p-6">
        <Link href="/login" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Voltar ao login
        </Link>
      </div>
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          {feito ? (
            <div className="text-center" data-testid="redefinir-sucesso">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6"><CheckCircle2 className="w-8 h-8 text-primary" aria-hidden="true" /></div>
              <h1 className="text-2xl font-bold mb-2">Palavra-passe alterada</h1>
              <p className="text-muted-foreground mb-8">Já podes entrar com a tua nova palavra-passe. Por segurança, as sessões abertas foram terminadas.</p>
              <Link href="/login"><Button className="w-full h-12 bg-primary hover:bg-primary/90 text-white font-semibold">Entrar</Button></Link>
            </div>
          ) : invalido ? (
            <div className="text-center" data-testid="redefinir-invalido">
              <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-6"><AlertTriangle className="w-8 h-8 text-destructive" aria-hidden="true" /></div>
              <h1 className="text-2xl font-bold mb-2">Ligação inválida ou expirada</h1>
              <p className="text-muted-foreground mb-8">Esta ligação já foi usada, expirou ou não está correta. Pede uma nova para redefinires a palavra-passe.</p>
              <Link href="/esqueceste-password"><Button className="w-full h-12 bg-primary hover:bg-primary/90 text-white font-semibold">Pedir nova ligação</Button></Link>
            </div>
          ) : pronto ? (
            <>
              <div className="mb-8">
                <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center mb-6"><KeyRound className="w-7 h-7 text-primary" aria-hidden="true" /></div>
                <h1 className="text-3xl font-bold mb-2">Nova palavra-passe</h1>
                <p className="text-muted-foreground">Escolhe uma palavra-passe com pelo menos 8 caracteres.</p>
              </div>
              <form onSubmit={submeter} className="space-y-5" noValidate>
                <div className="space-y-2">
                  <Label htmlFor="nova-password">Nova palavra-passe</Label>
                  <Input id="nova-password" type="password" autoComplete="new-password" className="h-12 bg-secondary/50" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmar-password">Confirma a palavra-passe</Label>
                  <Input id="confirmar-password" type="password" autoComplete="new-password" className="h-12 bg-secondary/50" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} />
                </div>
                {erro && <p role="alert" className="text-sm text-destructive" data-testid="redefinir-erro">{erro}</p>}
                <Button type="submit" disabled={aEnviar} className="w-full h-12 bg-primary hover:bg-primary/90 text-white font-semibold text-base">Guardar palavra-passe</Button>
              </form>
            </>
          ) : null}
        </div>
      </div>
      <RodapeLegal className="max-w-sm mx-auto px-4 pb-6" />
    </main>
  );
}
