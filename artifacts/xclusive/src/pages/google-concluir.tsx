import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from 'wouter';
import { Loader2 } from 'lucide-react';
import { googleComplete, type CurrentUser } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useAuth } from '@/contexts/AuthContext';
import { AuthSplitLayout, AuthHeader } from '@/components/AuthSplitLayout';
import { BlocoConsentimento } from '@/components/auth/BlocoConsentimento';
import { TextoAdvogado } from '@/components/auth/TextoAdvogado';
import { CHAVE_GOOGLE_NOME } from '@/components/auth/ContinuarComGoogle';
import { fetchLegalDocs } from './legal/useLegalDocs';

const schema = z.object({
  username: z.string().min(3, 'Username deve ter pelo menos 3 caracteres').regex(/^[a-zA-Z0-9_]+$/, 'Apenas letras, números e underscores'),
  dataNascimento: z.string().min(1, 'Data de nascimento é obrigatória'),
  documentos: z.literal(true, { errorMap: () => ({ message: 'Tens de aceitar os documentos legais' }) }),
  cookies: z.literal(true, { errorMap: () => ({ message: 'Tens de aceitar a utilização de cookies e de armazenamento local' }) }),
  maioridade: z.literal(true, { errorMap: () => ({ message: 'Tens de declarar que tens 18 anos ou mais' }) }),
});
type Valores = z.infer<typeof schema>;

/**
 * Passo 2 da criação de conta com o Google: a identidade (sub e email) já está no bilhete do servidor (cookie httpOnly); aqui só se pede o username, a data de
 * nascimento e o aceite dos MESMOS documentos do registo (as 5 versões vigentes lidas do servidor). O servidor repete todas as verificações.
 */
export default function GoogleConcluir() {
  const { entrarComToken } = useAuth();
  const [erro, setErro] = useState<{ texto: string; sessaoExpirada?: boolean } | null>(null);
  const nome = (() => { try { return sessionStorage.getItem(CHAVE_GOOGLE_NOME) || null; } catch { return null; } })();

  const form = useForm<Valores>({ resolver: zodResolver(schema), defaultValues: { username: '', dataNascimento: '' } });

  const onSubmit = async (d: Valores) => {
    setErro(null);
    try {
      const docs = await fetchLegalDocs();
      const r = await googleComplete({
        username: d.username,
        dataNascimento: d.dataNascimento,
        aceite: { termos: docs.termos.versao, privacidade: docs.privacidade.versao, conteudo: docs.conteudo.versao, direitosAutor: docs.direitosAutor.versao, reembolsos: docs.reembolsos.versao, cookies: true, maioridade: true },
      });
      try { sessionStorage.removeItem(CHAVE_GOOGLE_NOME); } catch { /* sem armazenamento */ }
      entrarComToken(r.token, r.user as CurrentUser, '/onboarding');
    } catch (e) {
      const err = e as { status?: number; data?: { codigo?: string; error?: string } } | null;
      const st = err?.status, cod = err?.data?.codigo, msg = typeof err?.data?.error === 'string' ? err.data.error : null;
      if (st === 400 && cod === 'bilhete_invalido') setErro({ texto: msg ?? 'A sessão de registo com o Google expirou. Volta a escolher «Continuar com o Google».', sessaoExpirada: true });
      else if (st === 403 && cod === 'registos_fechados') setErro({ texto: msg ?? 'Os registos estão fechados de momento. Volta a tentar mais tarde.', sessaoExpirada: true });
      else if (st === 409 && cod === 'username_em_uso') form.setError('username', { message: msg ?? 'Esse nome de utilizador já está em uso' });
      else if (msg && (st === 400 || st === 409)) setErro({ texto: msg });
      else if (st === 429) setErro({ texto: 'Demasiados pedidos. Tenta novamente mais tarde.' });
      else setErro({ texto: 'Não foi possível concluir a conta. Tenta novamente.' });
    }
  };

  return (
    <AuthSplitLayout frase="Junta-te à comunidade mais exclusiva de Angola." centroFixo>
      <AuthHeader titulo="Conclui a tua conta" subtitulo="Escolhe o teu nome de utilizador e confirma os teus dados." />
      {nome && <p className="text-sm text-muted-foreground" data-testid="google-nome">Conta Google: <strong className="text-foreground">{nome}</strong></p>}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" noValidate data-testid="google-concluir-form">
          <FormField control={form.control} name="username" render={({ field }) => (
            <FormItem>
              <FormLabel>Nome de utilizador</FormLabel>
              <FormControl><Input placeholder="@username" autoComplete="username" className="h-12 bg-secondary/50" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="dataNascimento" render={({ field }) => (
            <FormItem>
              <FormLabel>Data de nascimento</FormLabel>
              <FormControl><Input type="date" autoComplete="bday" className="h-12 bg-secondary/50" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <TextoAdvogado id="tratamentoDadosConclusao" />
          <BlocoConsentimento control={form.control} />
          {erro && (
            <div role="alert" className="rounded-xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-foreground space-y-2" data-testid="google-concluir-erro">
              <p>{erro.texto}</p>
              {erro.sessaoExpirada && <Link href="/login" className="inline-flex min-h-[44px] items-center font-semibold text-primary hover:underline" data-testid="google-concluir-voltar">Voltar ao início de sessão</Link>}
            </div>
          )}
          <Button type="submit" className="w-full h-12 text-base font-bold bg-primary hover:bg-primary/90 text-white rounded-xl"
            disabled={form.formState.isSubmitting || form.watch('documentos') !== true || form.watch('cookies') !== true || form.watch('maioridade') !== true} data-testid="google-concluir-enviar">
            {form.formState.isSubmitting ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> A criar...</> : 'Criar conta'}
          </Button>
        </form>
      </Form>
      <div className="text-center text-sm text-muted-foreground pt-4 border-t border-border">
        <Link href="/login" className="inline-flex min-h-[44px] items-center text-primary font-semibold hover:underline">Cancelar e voltar ao início de sessão</Link>
      </div>
    </AuthSplitLayout>
  );
}
