import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Loader2, FlaskConical } from 'lucide-react';
import { AuthSplitLayout, AuthHeader } from '@/components/AuthSplitLayout';

const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1, 'Password é obrigatória'),
  lembrar: z.boolean().optional(),
});

type LoginFormValues = z.infer<typeof loginSchema>;

/** Marca (por sessão do browser) de que a conta foi suspensa; também é posta pelo AuthContext ao expulsar uma sessão ativa. */
const CHAVE_SUSPENSA = 'xclusive_conta_suspensa';

/** Mensagem (por sessão do browser) de que a conta foi encerrada pelo próprio; posta ao encerrar, pelo AuthContext ao expulsar a sessão e aqui. */
const CHAVE_ENCERRADA = 'xclusive_conta_encerrada';

function lerMensagemEncerrada(): string | null {
  try { return sessionStorage.getItem(CHAVE_ENCERRADA); } catch { return null; }
}

function lerFlagSuspensa(): boolean {
  try { return sessionStorage.getItem(CHAVE_SUSPENSA) === '1'; } catch { return false; }
}

/** Estado público dos registos (GET /api/registos/estado). null = não foi possível ler (o servidor decide no envio). */
async function lerRegistosAbertos(): Promise<boolean | null> {
  try {
    const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
    const res = await fetch(`${base}/api/registos/estado`, { credentials: 'same-origin' });
    if (!res.ok) return null;
    const { abertos } = (await res.json()) as { abertos?: unknown };
    return typeof abertos === 'boolean' ? abertos : null;
  } catch {
    return null;
  }
}

/** E-mail de contacto (GET /api/reports/contact). Devolve null se falhar ou não tiver forma de e-mail. */
async function lerEmailContacto(): Promise<string | null> {
  try {
    const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
    const res = await fetch(`${base}/api/reports/contact`, { credentials: 'same-origin' });
    if (!res.ok) return null;
    const { email } = (await res.json()) as { email?: unknown };
    return typeof email === 'string' && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? email : null;
  } catch {
    return null;
  }
}

export default function Login() {
  const { login } = useAuth();
  const { toast } = useToast();
  const [suspensa, setSuspensa] = useState<boolean>(() => lerFlagSuspensa());
  const [encerrada, setEncerrada] = useState<string | null>(() => lerMensagemEncerrada());
  const [emailContacto, setEmailContacto] = useState<string | null>(null);
  // false = registos fechados pelo admin (null = ainda não sabemos / não foi possível ler: mostra o link normal)
  const [registosAbertos, setRegistosAbertos] = useState<boolean | null>(null);

  useEffect(() => {
    let vivo = true;
    lerRegistosAbertos().then((a) => { if (vivo) setRegistosAbertos(a); });
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    if (!suspensa) return;
    let vivo = true;
    lerEmailContacto().then((e) => { if (vivo) setEmailContacto(e); });
    return () => { vivo = false; };
  }, [suspensa]);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
      lembrar: false,
    },
  });

  const onSubmit = async (data: LoginFormValues) => {
    try {
      await login({ email: data.email, password: data.password, lembrar: data.lembrar });
      try { sessionStorage.removeItem(CHAVE_SUSPENSA); sessionStorage.removeItem(CHAVE_ENCERRADA); } catch { /* sem armazenamento */ }
    } catch (error: any) {
      // Conta encerrada (403 + codigo): aviso persistente com a mensagem do servidor, sem toast e sem sessão.
      if (error?.status === 403 && error?.data?.codigo === 'conta_encerrada' && typeof error?.data?.error === 'string') {
        try { sessionStorage.setItem(CHAVE_ENCERRADA, error.data.error); } catch { /* sem armazenamento */ }
        setEncerrada(error.data.error);
        return;
      }
      // Conta suspensa (403 + codigo): aviso persistente na página, sem toast e sem sessão.
      if (error?.status === 403 && error?.data?.codigo === 'conta_suspensa') {
        try { sessionStorage.setItem(CHAVE_SUSPENSA, '1'); } catch { /* sem armazenamento */ }
        setSuspensa(true);
        return;
      }
      toast({
        variant: 'destructive',
        title: 'Erro ao iniciar sessão',
        description: error.message || 'Verifica as tuas credenciais e tenta novamente.',
      });
    }
  };

  return (
    <AuthSplitLayout frase="Entra na tua conta e descobre o conteúdo mais exclusivo dos teus criadores favoritos.">
          <AuthHeader titulo="Bem-vindo de volta" subtitulo="Insere os teus dados para entrares na tua conta." />

          {encerrada && (
            <div role="alert" data-testid="aviso-conta-encerrada" className="rounded-xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-foreground">
              {encerrada}
            </div>
          )}

          {suspensa && (
            <div role="alert" data-testid="aviso-conta-suspensa" className="rounded-xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-foreground">
              <strong>A tua conta está suspensa.</strong>{' '}
              Se achas que é um engano, contacta{' '}
              {emailContacto ? (
                <a href={`mailto:${emailContacto}`} className="font-semibold text-primary underline" data-testid="aviso-suspensa-email">{emailContacto}</a>
              ) : (
                'o suporte'
              )}
              .
            </div>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input placeholder="O teu email" className="h-12 bg-secondary/50" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel>Password</FormLabel>
                      <Link href="/esqueceste-password" className="text-sm text-primary hover:underline">
                        Esqueceste a password?
                      </Link>
                    </div>
                    <FormControl>
                      <Input type="password" placeholder="A tua password" className="h-12 bg-secondary/50" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="lembrar"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel className="text-sm font-normal text-muted-foreground">
                        Lembrar-me neste dispositivo
                      </FormLabel>
                    </div>
                  </FormItem>
                )}
              />

              <Button 
                type="submit" 
                className="w-full h-12 text-base font-bold bg-primary hover:bg-primary/90 text-white rounded-xl"
                disabled={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting ? (
                  <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> A entrar...</>
                ) : (
                  'Entrar'
                )}
              </Button>
            </form>
          </Form>

          {/* Contas de teste: SÓ em desenvolvimento local (removidas do build de produção) */}
          {import.meta.env.DEV && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <FlaskConical className="w-3 h-3" /> Contas de teste
                </span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Utilizador', email: 'fan@xclusive.ao', badge: 'pessoal' },
                  { label: 'Criador', email: 'criador@xclusive.ao', badge: 'criador ✓' },
                ].map(({ label, email, badge }) => (
                  <button
                    key={email}
                    type="button"
                    disabled={form.formState.isSubmitting}
                    onClick={async () => {
                      form.setValue('email', email);
                      form.setValue('password', 'password123');
                      form.setValue('lembrar', false);
                      try {
                        await login({ email, password: 'password123' });
                      } catch (error: any) {
                        toast({
                          variant: 'destructive',
                          title: 'Erro ao entrar com conta de teste',
                          description: error.message || 'Verifica se a base de dados está configurada.',
                        });
                      }
                    }}
                    className="flex flex-col items-start gap-0.5 rounded-xl border border-border bg-secondary/40 hover:bg-secondary hover:border-primary/40 transition-all px-4 py-3 text-left disabled:opacity-50 disabled:cursor-not-allowed group"
                  >
                    <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">{label}</span>
                    <span className="text-[11px] text-muted-foreground">{badge}</span>
                  </button>
                ))}
              </div>
              <p className="text-center text-[11px] text-muted-foreground">password: <code className="bg-secondary px-1.5 py-0.5 rounded text-foreground">password123</code></p>
            </div>
          )}

          <div className="text-center text-sm text-muted-foreground pt-4 border-t border-border">
            Ainda não tens conta?{' '}
            {registosAbertos === false ? (
              <span className="font-semibold text-foreground" data-testid="registos-fechados-login">
                Os registos estão temporariamente fechados.
              </span>
            ) : (
              <Link href="/registo" className="text-primary font-semibold hover:underline">
                Cria uma conta grátis
              </Link>
            )}
          </div>
    </AuthSplitLayout>
  );
}
