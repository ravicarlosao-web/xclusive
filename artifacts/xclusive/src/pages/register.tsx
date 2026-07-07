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
import { Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';

const registerSchema = z.object({
  nomeCompleto: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres'),
  email: z.string().email('Email inválido'),
  username: z.string().min(3, 'Username deve ter pelo menos 3 caracteres').regex(/^[a-zA-Z0-9_]+$/, 'Apenas letras, números e underscores'),
  password: z.string().min(8, 'Password deve ter pelo menos 8 caracteres'),
  dataNascimento: z.string().min(1, 'Data de nascimento é obrigatória'),
  termos: z.literal(true, {
    errorMap: () => ({ message: 'Tens de aceitar os termos e condições' })
  }),
});

type RegisterFormValues = z.infer<typeof registerSchema>;

export default function Register() {
  const { register } = useAuth();
  const { toast } = useToast();
  const [passwordStrength, setPasswordStrength] = useState(0);

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      nomeCompleto: '',
      email: '',
      username: '',
      password: '',
      dataNascimento: '',
    },
  });

  const watchPassword = form.watch('password');

  useEffect(() => {
    if (!watchPassword) {
      setPasswordStrength(0);
      return;
    }
    let strength = 0;
    if (watchPassword.length >= 8) strength += 1;
    if (/[A-Z]/.test(watchPassword)) strength += 1;
    if (/[0-9]/.test(watchPassword)) strength += 1;
    if (/[^A-Za-z0-9]/.test(watchPassword)) strength += 1;
    setPasswordStrength(strength);
  }, [watchPassword]);

  const onSubmit = async (data: RegisterFormValues) => {
    try {
      await register({
        nomeCompleto: data.nomeCompleto,
        email: data.email,
        username: data.username,
        password: data.password,
        dataNascimento: data.dataNascimento,
      });
      // Will navigate to onboarding automatically via AuthContext
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Erro ao criar conta',
        description: error.message || 'Verifica os dados e tenta novamente.',
      });
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 py-12">
      <Link href="/" className="text-3xl font-extrabold tracking-tighter mb-8 text-center block">
        <span className="text-primary">X</span>clusive
      </Link>

      <div className="w-full max-w-md bg-card border border-border rounded-2xl p-8 shadow-2xl">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-white mb-2">Cria a tua conta</h1>
          <p className="text-muted-foreground text-sm">Junta-te à comunidade mais exclusiva.</p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <FormField
              control={form.control}
              name="nomeCompleto"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome Completo</FormLabel>
                  <FormControl>
                    <Input placeholder="O teu nome" className="bg-secondary/50" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl>
                      <Input placeholder="@username" className="bg-secondary/50" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="dataNascimento"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Data de Nascimento</FormLabel>
                    <FormControl>
                      <Input type="date" className="bg-secondary/50 block w-full text-white color-scheme-dark" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="O teu email" className="bg-secondary/50" {...field} />
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
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="Cria uma password segura" className="bg-secondary/50" {...field} />
                  </FormControl>
                  
                  {watchPassword && (
                    <div className="flex items-center gap-1 mt-2 h-1.5">
                      {[1, 2, 3, 4].map((level) => (
                        <div 
                          key={level} 
                          className={`flex-1 h-full rounded-full transition-colors ${
                            passwordStrength >= level 
                              ? passwordStrength === 1 ? 'bg-red-500' 
                                : passwordStrength === 2 ? 'bg-orange-500'
                                : passwordStrength === 3 ? 'bg-yellow-500'
                                : 'bg-green-500'
                              : 'bg-secondary'
                          }`} 
                        />
                      ))}
                    </div>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="termos"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 pt-2">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel className="text-sm font-normal text-muted-foreground">
                      Concordo com os <a href="#" className="text-primary hover:underline">Termos de Serviço</a> e a <a href="#" className="text-primary hover:underline">Política de Privacidade</a>.
                    </FormLabel>
                    <FormMessage />
                  </div>
                </FormItem>
              )}
            />

            <Button 
              type="submit" 
              className="w-full h-12 text-base font-bold bg-primary hover:bg-primary/90 text-white rounded-xl mt-6"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? (
                <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> A criar conta...</>
              ) : (
                'Criar conta'
              )}
            </Button>
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