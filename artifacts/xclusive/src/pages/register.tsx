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
import { Loader2, User, Camera, ChevronDown } from 'lucide-react';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';

// ── Country / phone prefix config ──────────────────────────────────────────
const COUNTRIES = [
  { code: 'AO', name: 'Angola', flag: '🇦🇴', prefix: '+244', placeholder: '9xx xxx xxx' },
  { code: 'MZ', name: 'Moçambique', flag: '🇲🇿', prefix: '+258', placeholder: '8x xxx xxxx' },
  { code: 'ZA', name: 'África do Sul', flag: '🇿🇦', prefix: '+27', placeholder: '7x xxx xxxx' },
  { code: 'PT', name: 'Portugal', flag: '🇵🇹', prefix: '+351', placeholder: '9xx xxx xxx' },
  { code: 'BR', name: 'Brasil', flag: '🇧🇷', prefix: '+55', placeholder: '(xx) xxxxx-xxxx' },
  { code: 'OTHER', name: 'Outro país', flag: '🌍', prefix: '+', placeholder: 'número de telefone' },
] as const;

type CountryCode = typeof COUNTRIES[number]['code'];

// ── Zod schema ──────────────────────────────────────────────────────────────
const registerSchema = z.object({
  nomeCompleto: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres'),
  email: z.string().email('Email inválido'),
  username: z
    .string()
    .min(3, 'Username deve ter pelo menos 3 caracteres')
    .regex(/^[a-zA-Z0-9_]+$/, 'Apenas letras, números e underscores'),
  password: z.string().min(8, 'Password deve ter pelo menos 8 caracteres'),
  dataNascimento: z.string().min(1, 'Data de nascimento é obrigatória'),
  telefone: z.string().optional(),
  tipoConta: z.enum(['pessoal', 'criador']),
  termos: z.literal(true, {
    errorMap: () => ({ message: 'Tens de aceitar os termos e condições' }),
  }),
});

type RegisterFormValues = z.infer<typeof registerSchema>;

// ── Component ────────────────────────────────────────────────────────────────
export default function Register() {
  const { register } = useAuth();
  const { toast } = useToast();
  const [passwordStrength, setPasswordStrength] = useState(0);
  const [selectedCountry, setSelectedCountry] = useState<CountryCode>('AO');
  const [countryDropOpen, setCountryDropOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);

  const country = COUNTRIES.find(c => c.code === selectedCountry)!;

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      nomeCompleto: '',
      email: '',
      username: '',
      password: '',
      dataNascimento: '',
      telefone: '',
      tipoConta: 'pessoal',
    },
  });

  const watchPassword = form.watch('password');
  const watchTipoConta = form.watch('tipoConta');

  useEffect(() => {
    if (!watchPassword) { setPasswordStrength(0); return; }
    let strength = 0;
    if (watchPassword.length >= 8) strength += 1;
    if (/[A-Z]/.test(watchPassword)) strength += 1;
    if (/[0-9]/.test(watchPassword)) strength += 1;
    if (/[^A-Za-z0-9]/.test(watchPassword)) strength += 1;
    setPasswordStrength(strength);
  }, [watchPassword]);

  const strengthLabel = ['', 'Fraca', 'Razoável', 'Boa', 'Forte'];
  const strengthColors = ['', 'bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-green-500'];

  const onSubmit = async (data: RegisterFormValues) => {
    try {
      await register({
        nomeCompleto: data.nomeCompleto,
        email: data.email,
        username: data.username,
        password: data.password,
        dataNascimento: data.dataNascimento,
        pais: country.name,
        telefone: data.telefone ? `${country.prefix}${data.telefone}` : undefined,
        tipoConta: data.tipoConta,
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Erro ao criar conta',
        description: error.message || 'Verifica os dados e tenta novamente.',
      });
    }
  };

  // Validate step 1 fields before going to step 2
  const goToStep2 = async () => {
    const valid = await form.trigger(['nomeCompleto', 'username', 'dataNascimento', 'email', 'password']);
    if (valid) setStep(2);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 py-12">
      <Link href="/" className="text-3xl font-extrabold tracking-tighter mb-8 text-center block">
        <span className="text-primary">X</span>clusive
      </Link>

      <div className="w-full max-w-md bg-card border border-border rounded-2xl p-8 shadow-2xl">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-white mb-1">Cria a tua conta</h1>
          <p className="text-muted-foreground text-sm">Junta-te à comunidade mais exclusiva de Angola.</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-7">
          {[1, 2].map(s => (
            <div key={s} className={cn('h-1.5 flex-1 rounded-full transition-all', s <= step ? 'bg-primary' : 'bg-secondary')} />
          ))}
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">

            {/* ── STEP 1: Basic info ── */}
            {step === 1 && (
              <>
                <FormField control={form.control} name="nomeCompleto" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome Completo</FormLabel>
                    <FormControl>
                      <Input placeholder="O teu nome completo" className="bg-secondary/50" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <FormField control={form.control} name="username" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username</FormLabel>
                      <FormControl>
                        <Input placeholder="@username" className="bg-secondary/50" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="dataNascimento" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Data de Nascimento</FormLabel>
                      <FormControl>
                        <Input type="date" className="bg-secondary/50 block w-full text-white color-scheme-dark" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="o.teu@email.com" className="bg-secondary/50" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="password" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="Cria uma password segura" className="bg-secondary/50" {...field} />
                    </FormControl>
                    {watchPassword && (
                      <>
                        <div className="flex items-center gap-1 mt-2 h-1.5">
                          {[1, 2, 3, 4].map((level) => (
                            <div key={level} className={cn(
                              'flex-1 h-full rounded-full transition-colors',
                              passwordStrength >= level ? strengthColors[passwordStrength] : 'bg-secondary'
                            )} />
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{strengthLabel[passwordStrength]}</p>
                      </>
                    )}
                    <FormMessage />
                  </FormItem>
                )} />

                <Button
                  type="button"
                  onClick={goToStep2}
                  className="w-full h-12 text-base font-bold bg-primary hover:bg-primary/90 text-white rounded-xl mt-2"
                >
                  Continuar
                </Button>
              </>
            )}

            {/* ── STEP 2: Country, phone, account type ── */}
            {step === 2 && (
              <>
                {/* Country selector */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">País</label>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setCountryDropOpen(o => !o)}
                      className="w-full flex items-center justify-between gap-3 h-10 px-3 rounded-lg bg-secondary/50 border border-input text-sm hover:bg-secondary transition-colors"
                    >
                      <span className="flex items-center gap-2">
                        <span className="text-lg">{country.flag}</span>
                        <span>{country.name}</span>
                      </span>
                      <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform', countryDropOpen && 'rotate-180')} />
                    </button>

                    {countryDropOpen && (
                      <div className="absolute z-50 top-full mt-1 w-full bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
                        {COUNTRIES.map(c => (
                          <button
                            key={c.code}
                            type="button"
                            onClick={() => { setSelectedCountry(c.code); setCountryDropOpen(false); }}
                            className={cn(
                              'w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-secondary transition-colors',
                              selectedCountry === c.code && 'bg-primary/10 text-primary'
                            )}
                          >
                            <span className="text-lg">{c.flag}</span>
                            <span>{c.name}</span>
                            <span className="ml-auto text-muted-foreground text-xs">{c.prefix}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Phone number */}
                <FormField control={form.control} name="telefone" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Telefone <span className="text-muted-foreground font-normal">(opcional)</span></FormLabel>
                    <FormControl>
                      <div className="flex gap-2">
                        <div className="flex items-center h-10 px-3 rounded-lg bg-secondary/50 border border-input text-sm shrink-0 text-muted-foreground gap-1.5">
                          <span>{country.flag}</span>
                          <span>{country.prefix}</span>
                        </div>
                        <Input
                          type="tel"
                          placeholder={country.placeholder}
                          className="bg-secondary/50 flex-1"
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* Account type */}
                <FormField control={form.control} name="tipoConta" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo de Conta</FormLabel>
                    <div className="grid grid-cols-2 gap-3 mt-1">
                      <button
                        type="button"
                        onClick={() => field.onChange('pessoal')}
                        className={cn(
                          'flex flex-col items-start p-4 border rounded-xl transition-all text-left',
                          field.value === 'pessoal'
                            ? 'border-primary bg-primary/10'
                            : 'border-border bg-secondary/50 hover:bg-secondary'
                        )}
                      >
                        <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center mb-2">
                          <User className="w-4 h-4" />
                        </div>
                        <span className="font-bold text-sm mb-0.5">Fã / Pessoal</span>
                        <span className="text-xs text-muted-foreground">Segue criadores e descobre conteúdo exclusivo.</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => field.onChange('criador')}
                        className={cn(
                          'flex flex-col items-start p-4 border rounded-xl transition-all text-left',
                          field.value === 'criador'
                            ? 'border-primary bg-primary/10'
                            : 'border-border bg-secondary/50 hover:bg-secondary'
                        )}
                      >
                        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center mb-2">
                          <Camera className="w-4 h-4 text-primary" />
                        </div>
                        <span className="font-bold text-sm mb-0.5 text-primary">Criador</span>
                        <span className="text-xs text-muted-foreground">Partilha conteúdo e ganha em Kwanza.</span>
                      </button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* Terms */}
                <FormField control={form.control} name="termos" render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0 pt-2">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel className="text-sm font-normal text-muted-foreground">
                        Concordo com os{' '}
                        <a href="#" className="text-primary hover:underline">Termos de Serviço</a>{' '}
                        e a{' '}
                        <a href="#" className="text-primary hover:underline">Política de Privacidade</a>.
                      </FormLabel>
                      <FormMessage />
                    </div>
                  </FormItem>
                )} />

                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep(1)}
                    className="flex-1 h-12 font-semibold rounded-xl border-border"
                  >
                    Voltar
                  </Button>
                  <Button
                    type="submit"
                    className="flex-1 h-12 text-base font-bold bg-primary hover:bg-primary/90 text-white rounded-xl"
                    disabled={form.formState.isSubmitting}
                  >
                    {form.formState.isSubmitting ? (
                      <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> A criar...</>
                    ) : 'Criar conta'}
                  </Button>
                </div>
              </>
            )}
          </form>
        </Form>

        <div className="text-center text-sm text-muted-foreground pt-6 mt-6 border-t border-border">
          Já tens conta?{' '}
          <Link href="/login" className="text-primary font-semibold hover:underline">
            Entra aqui
          </Link>
        </div>
      </div>
    </div>
  );
}
