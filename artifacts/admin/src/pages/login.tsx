import { useEffect, useRef, useState } from 'react';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';

export default function Login() {
  const { login, loginTotp } = useAdminAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  // 2.º passo (TOTP). O pré-token vive SÓ em memória deste ecrã (nunca em armazenamento, URL nem consola) e gasta-se à primeira tentativa.
  const [preAuth, setPreAuth] = useState<string | null>(null);
  const [usarRecuperacao, setUsarRecuperacao] = useState(false);
  const [codigo, setCodigo] = useState('');
  const [aviso, setAviso] = useState('');
  const expiraEm = useRef(0);

  const voltarAoPasso1 = (mensagem: string) => {
    setPreAuth(null); setCodigo(''); setPassword(''); setUsarRecuperacao(false); setAviso(mensagem);
    expiraEm.current = 0;
  };

  // O pré-token vale 5 minutos: passado esse tempo volta ao primeiro passo com uma mensagem própria.
  useEffect(() => {
    if (!preAuth) return;
    const ms = Math.max(0, expiraEm.current - Date.now());
    const id = window.setTimeout(() => voltarAoPasso1('A verificação expirou. Introduza novamente a palavra-passe.'), ms);
    return () => window.clearTimeout(id);
  }, [preAuth]);

  const handleSubmitTotp = async (evt: React.FormEvent) => {
    evt.preventDefault();
    if (!preAuth) return;
    if (Date.now() >= expiraEm.current) { voltarAoPasso1('A verificação expirou. Introduza novamente a palavra-passe.'); return; }
    setIsLoading(true);
    const token = preAuth;
    setPreAuth(null);   // gasto à primeira tentativa (o servidor também o gasta): nunca se reenvia
    try {
      await loginTotp(token, usarRecuperacao ? { recuperacao: codigo.trim() } : { codigo: codigo.replace(/\s+/g, '') });
      setLocation('/dashboard');
    } catch (error: any) {
      // Mensagem igual para código errado, expirado ou repetido; só os erros de serviço (429/503) mostram a mensagem do servidor.
      voltarAoPasso1(error?.status === 429 || error?.status === 503 ? (error.message || 'Serviço indisponível. Tente mais tarde.') : 'Código incorreto. Introduza novamente a palavra-passe.');
    } finally {
      setCodigo('');
      setIsLoading(false);
    }
  };

  const handleSubmit = async (evt: React.FormEvent) => {
    evt.preventDefault();
    setIsLoading(true);
    setAviso('');
    try {
      const r = await login(email, password);
      if (r.totpNecessario) {
        expiraEm.current = Date.now() + r.expiresIn * 1000;
        setPassword('');   // já não é precisa em memória
        setPreAuth(r.preAuth);
        return;
      }
      setLocation('/dashboard');
    } catch (error: any) {
      toast({
        title: 'Erro de Autenticação',
        description: error.message || 'Credenciais inválidas',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen w-full flex items-center justify-center bg-background relative overflow-hidden">
      <h1 className="sr-only">Painel de administração: entrar</h1>
      {/* Ambient glow */}
      <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-primary/15 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[400px] h-[400px] bg-primary/8 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative z-10 w-full max-w-sm px-4">
        <Card className="border-border/50 shadow-2xl bg-card/80 backdrop-blur-xl">
          <CardHeader className="space-y-2 text-center pb-6">
            <div className="flex justify-center mb-4">
              <img src={import.meta.env.BASE_URL + 'logo.png'} alt="Xclusive" className="h-10 w-auto object-contain drop-shadow-[0_0_20px_rgba(255,59,92,0.3)]" />
            </div>
            <CardTitle className="text-xl font-medium tracking-tight text-muted-foreground">
              Painel <span className="font-bold text-foreground">Admin</span>
            </CardTitle>
            <CardDescription className="text-muted-foreground font-mono text-xs uppercase tracking-widest">
              Command Centre
            </CardDescription>
          </CardHeader>

          <CardContent>
            {aviso && <p role="alert" data-testid="aviso-login" className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{aviso}</p>}
            {preAuth ? (
              <form onSubmit={handleSubmitTotp} className="space-y-4" data-testid="passo-totp">
                <div className="flex justify-center"><ShieldCheck className="h-8 w-8 text-primary" aria-hidden="true" /></div>
                <p className="text-center text-sm text-muted-foreground">
                  {usarRecuperacao
                    ? 'Introduza um dos códigos de recuperação que guardou. Cada um só funciona uma vez.'
                    : 'Introduza o código de 6 dígitos da sua aplicação de autenticação.'}
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="codigo-totp" className="text-xs uppercase tracking-wider text-muted-foreground">{usarRecuperacao ? 'Código de recuperação' : 'Código de verificação'}</Label>
                  {usarRecuperacao ? (
                    <Input id="codigo-totp" name="codigo-recuperacao" type="text" value={codigo} onChange={(e) => setCodigo(e.target.value)} required autoFocus
                      autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={14} placeholder="XXXXX-XXXXX"
                      data-1p-ignore="true" data-lpignore="true" data-bwignore="true" data-form-type="other" className="bg-background/50 border-border h-11 font-mono tracking-widest" />
                  ) : (
                    <Input id="codigo-totp" name="codigo-verificacao" type="text" inputMode="numeric" pattern="[0-9 ]*" value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/[^0-9 ]/g, ''))} required autoFocus
                      autoComplete="one-time-code" maxLength={7} placeholder="000000" spellCheck={false}
                      data-1p-ignore="true" data-lpignore="true" data-bwignore="true" data-form-type="other" className="bg-background/50 border-border h-11 font-mono text-center text-lg tracking-[0.4em]" />
                  )}
                </div>
                <Button type="submit" className="w-full h-11 font-semibold" disabled={isLoading}>
                  {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Verificar'}
                </Button>
                <div className="flex flex-col items-center gap-1">
                  <Button type="button" variant="link" className="h-auto p-1 text-xs" onClick={() => { setUsarRecuperacao(!usarRecuperacao); setCodigo(''); }}>
                    {usarRecuperacao ? 'Usar o código da aplicação' : 'Usar um código de recuperação'}
                  </Button>
                  <Button type="button" variant="ghost" className="h-auto p-1 text-xs text-muted-foreground" onClick={() => voltarAoPasso1('')}>Voltar</Button>
                </div>
              </form>
            ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs uppercase tracking-wider text-muted-foreground">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@xclusive.ao"
                  required
                  className="bg-background/50 border-border h-11"
                  autoComplete="email"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs uppercase tracking-wider text-muted-foreground">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="bg-background/50 border-border h-11"
                  autoComplete="current-password"
                />
              </div>
              <Button
                type="submit"
                className="w-full h-11 font-semibold"
                disabled={isLoading}
              >
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Entrar'}
              </Button>
            </form>
            )}
          </CardContent>

          <CardFooter className="flex justify-center text-xs text-muted-foreground pb-5 pt-2">
            Acesso restrito a operadores da plataforma.
          </CardFooter>
        </Card>
      </div>
    </main>
  );
}
