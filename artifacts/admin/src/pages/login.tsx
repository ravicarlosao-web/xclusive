import { useState } from 'react';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import {
  Loader2, ShieldAlert, Zap, Users, TrendingUp, Flag,
  LayoutDashboard, Wallet, ShieldCheck, Image, Bell, ClipboardList
} from 'lucide-react';

const DEMO_EMAIL = 'admin@xclusive.com';
const DEMO_PASSWORD = 'admin123';

const DEMO_FEATURES = [
  { icon: LayoutDashboard, label: 'Dashboard com KPIs em tempo real e gráficos de receita' },
  { icon: Users,           label: '48 utilizadores de AO, PT, BR, MZ e ZA com detalhe completo' },
  { icon: ShieldCheck,     label: 'Fila KYC com documentos e aprovação/rejeição de criadores' },
  { icon: Flag,            label: '22 denúncias com filtros por tipo, estado e motivo' },
  { icon: TrendingUp,      label: 'Painel financeiro com 40 transações e exportação CSV' },
  { icon: Wallet,          label: '14 pedidos de levantamento para aprovar ou rejeitar' },
  { icon: Image,           label: 'Moderação de conteúdo com lightbox de media' },
  { icon: Bell,            label: 'Broadcast de notificações por segmento de utilizador' },
  { icon: ClipboardList,   label: 'Audit log completo de todas as acções administrativas' },
];

export default function Login() {
  const { login } = useAdminAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isDemoLoading, setIsDemoLoading] = useState(false);

  const doLogin = async (e: string, p: string) => {
    try {
      await login(e, p);
      setLocation('/dashboard');
    } catch (error: any) {
      toast({
        title: 'Erro de Autenticação',
        description: error.message || 'Credenciais inválidas',
        variant: 'destructive',
      });
    }
  };

  const handleSubmit = async (evt: React.FormEvent) => {
    evt.preventDefault();
    setIsLoading(true);
    await doLogin(email, password);
    setIsLoading(false);
  };

  const handleDemo = async () => {
    setIsDemoLoading(true);
    await doLogin(DEMO_EMAIL, DEMO_PASSWORD);
    setIsDemoLoading(false);
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background relative overflow-hidden py-8">
      {/* Ambient glow */}
      <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-primary/15 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[400px] h-[400px] bg-primary/8 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative z-10 w-full max-w-4xl px-4 flex flex-col lg:flex-row gap-6 items-stretch">

        {/* ── Left: demo info panel ── */}
        <div className="flex-1 flex flex-col justify-center space-y-5 lg:pr-6">
          <div>
            <p className="text-xs font-mono text-primary uppercase tracking-widest mb-2">Conta de demonstração</p>
            <h1 className="text-3xl font-bold text-foreground leading-tight">
              Explore o painel<br />
              <span className="text-primary">sem restrições</span>
            </h1>
            <p className="mt-3 text-muted-foreground text-sm leading-relaxed">
              Acesso instantâneo a dados simulados realistas. Testa cada funcionalidade,
              aprova levantamentos, valida KYCs e explora todas as páginas — nenhum dado real é alterado.
            </p>
          </div>

          <ul className="space-y-3">
            {DEMO_FEATURES.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-start gap-3">
                <div className="mt-0.5 flex-shrink-0 h-6 w-6 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <Icon className="h-3.5 w-3.5 text-primary" />
                </div>
                <span className="text-sm text-muted-foreground leading-snug">{label}</span>
              </li>
            ))}
          </ul>

          <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
            <p className="text-xs text-muted-foreground font-mono">
              <span className="text-primary font-semibold">Email:</span> {DEMO_EMAIL}
              &nbsp;&nbsp;
              <span className="text-primary font-semibold">Password:</span> {DEMO_PASSWORD}
            </p>
          </div>
        </div>

        {/* ── Right: login card ── */}
        <div className="w-full lg:w-[380px] flex-shrink-0">
          <Card className="border-border/50 shadow-2xl bg-card/80 backdrop-blur-xl h-full flex flex-col justify-center">
            <CardHeader className="space-y-2 text-center pb-6">
              <div className="flex justify-center mb-3">
                <div className="h-14 w-14 bg-primary/10 rounded-2xl flex items-center justify-center border border-primary/20">
                  <ShieldAlert className="h-7 w-7 text-primary" />
                </div>
              </div>
              <CardTitle className="text-2xl font-bold tracking-tight">
                <span className="text-primary">X</span>clusive <span className="font-light">Admin</span>
              </CardTitle>
              <CardDescription className="text-muted-foreground font-mono text-xs uppercase tracking-widest">
                Command Centre
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-5">
              {/* Demo button — primary CTA */}
              <Button
                onClick={handleDemo}
                disabled={isDemoLoading || isLoading}
                className="w-full h-12 font-bold tracking-wide gap-2 text-base shadow-lg shadow-primary/20"
              >
                {isDemoLoading
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Zap className="h-4 w-4" />
                }
                Entrar como Demonstração
              </Button>

              {/* Divider */}
              <div className="relative flex items-center gap-3">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground uppercase tracking-wider">ou entrar manualmente</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              {/* Manual login form */}
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs uppercase tracking-wider text-muted-foreground">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@xclusive.com"
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
                  variant="outline"
                  className="w-full h-11 mt-1"
                  disabled={isLoading || isDemoLoading}
                >
                  {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Entrar'}
                </Button>
              </form>
            </CardContent>

            <CardFooter className="flex justify-center text-xs text-muted-foreground pb-5 pt-2">
              Acesso restrito a operadores da plataforma.
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}
