import { useState } from 'react';
import { useLocation } from 'wouter';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { adminApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2, KeyRound } from 'lucide-react';

/**
 * Troca da própria palavra-passe. Com `obrigatoria` (marca do servidor) é a ÚNICA coisa que o painel mostra, sem menu, até a troca estar concluída.
 * As palavras-passe vivem só no estado do componente: nunca vão para localStorage, URL nem logs, e são limpas depois de cada pedido.
 */
export default function TrocarPassword({ obrigatoria = false }: { obrigatoria?: boolean }) {
  const { aposTrocaPassword, logout } = useAdminAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [aEnviar, setAEnviar] = useState(false);
  const [erro, setErro] = useState('');

  const submeter = async (evt: React.FormEvent) => {
    evt.preventDefault();
    setErro('');
    if (nova !== confirmacao) { setErro('A confirmação não coincide com a nova palavra-passe.'); return; }
    setAEnviar(true);
    try {
      const r = await adminApi.changePassword(atual, nova, confirmacao);
      aposTrocaPassword(r.token);
      toast({ title: 'Palavra-passe alterada', description: 'As outras sessões foram terminadas.' });
      setLocation('/dashboard');
    } catch (e: any) {
      setErro(e?.message || 'Não foi possível alterar a palavra-passe.');
    } finally {
      setAtual(''); setNova(''); setConfirmacao('');   // nunca ficam em memória depois do pedido
      setAEnviar(false);
    }
  };

  const formulario = (
    <Card className="border-border/50 shadow-2xl bg-card/80 backdrop-blur-xl w-full max-w-sm">
      <CardHeader className="space-y-2 text-center pb-4">
        <div className="flex justify-center"><KeyRound className="h-8 w-8 text-primary" /></div>
        <CardTitle className="text-xl font-medium tracking-tight">Alterar palavra-passe</CardTitle>
        <CardDescription className="text-xs">
          {obrigatoria
            ? 'Por segurança, tens de definir uma nova palavra-passe antes de continuar.'
            : 'Mínimo de 12 caracteres, sem palavras óbvias nem o teu email ou utilizador.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submeter} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="atual" className="text-xs uppercase tracking-wider text-muted-foreground">Palavra-passe atual</Label>
            <Input id="atual" type="password" value={atual} onChange={(e) => setAtual(e.target.value)} required autoComplete="current-password" className="bg-background/50 border-border h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nova" className="text-xs uppercase tracking-wider text-muted-foreground">Nova palavra-passe</Label>
            <Input id="nova" type="password" value={nova} onChange={(e) => setNova(e.target.value)} required minLength={12} maxLength={128} autoComplete="new-password" className="bg-background/50 border-border h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirmacao" className="text-xs uppercase tracking-wider text-muted-foreground">Confirmar nova palavra-passe</Label>
            <Input id="confirmacao" type="password" value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} required minLength={12} maxLength={128} autoComplete="new-password" className="bg-background/50 border-border h-11" />
          </div>
          {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
          <Button type="submit" className="w-full h-11" disabled={aEnviar}>
            {aEnviar ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Alterar palavra-passe'}
          </Button>
          {obrigatoria && (
            <Button type="button" variant="ghost" className="w-full" onClick={logout}>Terminar sessão</Button>
          )}
        </form>
      </CardContent>
    </Card>
  );

  if (obrigatoria) {
    return <div className="min-h-screen w-full flex items-center justify-center bg-background px-4">{formulario}</div>;
  }
  return <div className="flex justify-center p-4 md:p-8">{formulario}</div>;
}
