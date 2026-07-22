import { useState } from 'react';
import { Link } from 'wouter';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Mail, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';

const schema = z.object({
  email: z.string().email('Insere um email válido'),
});

type FormValues = z.infer<typeof schema>;

export default function EsquecestePassword() {
  const [submitted, setSubmitted] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  });

  const onSubmit = (_values: FormValues) => {
    setSubmitted(true);
  };

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      {/* Back link */}
      <div className="p-6">
        <Link href="/login" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Voltar ao login
        </Link>
      </div>

      <div className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          {submitted ? (
            /* Success state */
            <div className="text-center">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckCircle2 className="w-8 h-8 text-primary" />
              </div>
              <h1 className="text-2xl font-bold mb-2">Email enviado!</h1>
              <p className="text-muted-foreground mb-8">
                Se existir uma conta com esse email, receberás um link para redefinir a tua password em breve.
              </p>
              <Link href="/login">
                <Button className="w-full h-12 bg-primary hover:bg-primary/90 text-white font-semibold">
                  Voltar ao login
                </Button>
              </Link>
            </div>
          ) : (
            /* Form state */
            <>
              <div className="mb-8">
                <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center mb-6">
                  <Mail className="w-7 h-7 text-primary" />
                </div>
                <h1 className="text-3xl font-bold mb-2">Esqueceste a password?</h1>
                <p className="text-muted-foreground">
                  Insere o teu email e enviamos um link para recuperares o acesso à tua conta.
                </p>
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
                          <Input
                            type="email"
                            placeholder="O teu email"
                            className="h-12 bg-secondary/50"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button
                    type="submit"
                    className="w-full h-12 bg-primary hover:bg-primary/90 text-white font-semibold text-base"
                    disabled={form.formState.isSubmitting}
                  >
                    Enviar link de recuperação
                  </Button>
                </form>
              </Form>

              <p className="text-center text-sm text-muted-foreground mt-6">
                Lembras-te da password?{' '}
                <Link href="/login" className="text-primary hover:underline font-medium">
                  Entrar
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
