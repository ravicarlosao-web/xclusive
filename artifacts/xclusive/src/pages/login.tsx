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

const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1, 'Password é obrigatória'),
  lembrar: z.boolean().optional(),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function Login() {
  const { login } = useAuth();
  const { toast } = useToast();

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
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Erro ao iniciar sessão',
        description: error.message || 'Verifica as tuas credenciais e tenta novamente.',
      });
    }
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Left side - Image/Branding */}
      <div className="hidden lg:flex lg:w-1/2 relative bg-secondary overflow-hidden items-center justify-center">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-background to-background z-10" />
        <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1616469829581-73993eb86b02?q=80&w=2070&auto=format&fit=crop')] bg-cover bg-center opacity-30 mix-blend-overlay" />
        
        <div className="relative z-20 flex flex-col items-center text-center p-12">
          <div className="text-6xl font-extrabold tracking-tighter mb-6">
            <span className="text-primary">X</span>
            <span className="text-white">clusive</span>
          </div>
          <p className="text-xl text-gray-300 max-w-md font-medium">
            Entra na tua conta e descobre o conteúdo mais exclusivo dos teus criadores favoritos.
          </p>
        </div>
      </div>

      {/* Right side - Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center lg:text-left mb-10">
            <div className="lg:hidden text-4xl font-extrabold tracking-tighter mb-6">
              <span className="text-primary">X</span>clusive
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Bem-vindo de volta</h1>
            <p className="text-muted-foreground">Insere os teus dados para entrares na tua conta.</p>
          </div>

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

          <div className="text-center text-sm text-muted-foreground pt-4 border-t border-border">
            Ainda não tens conta?{' '}
            <Link href="/registo" className="text-primary font-semibold hover:underline">
              Cria uma conta grátis
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}