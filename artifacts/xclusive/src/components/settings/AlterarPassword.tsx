import { useState } from 'react';
import { changePassword } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';

/** Alterar a palavra-passe com sessão iniciada (palavra-passe atual + nova). Ao concluir todas as sessões terminam, incluindo esta: volta ao login. */
export function AlterarPassword() {
  const { logout } = useAuth();
  const { toast } = useToast();
  const [aberto, setAberto] = useState(false);
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [aEnviar, setAEnviar] = useState(false);

  const fechar = () => { setAberto(false); setAtual(''); setNova(''); setConfirmar(''); setErro(null); };

  const submeter = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    if (!atual) { setErro('Indica a palavra-passe atual.'); return; }
    if (nova.length < 8) { setErro('A nova palavra-passe deve ter pelo menos 8 caracteres.'); return; }
    if (nova.length > 128) { setErro('A nova palavra-passe pode ter no máximo 128 caracteres.'); return; }
    if (nova !== confirmar) { setErro('As palavras-passe novas não coincidem.'); return; }
    setAEnviar(true);
    try {
      await changePassword({ passwordAtual: atual, novaPassword: nova });
      toast({ title: 'Palavra-passe alterada', description: 'Por segurança, as sessões foram terminadas. Entra de novo com a nova palavra-passe.' });
      await logout();
    } catch (err) {
      const e2 = err as { status?: number; data?: { codigo?: string; error?: string; details?: { mensagem?: string }[] } } | null;
      const st = e2?.status, cod = e2?.data?.codigo;
      if (st === 403 && cod === 'password_incorreta') setErro('A palavra-passe atual está incorreta.');
      else if (st === 400 && cod === 'password_igual') setErro('A nova palavra-passe tem de ser diferente da atual.');
      else if (st === 400) setErro(e2?.data?.details?.[0]?.mensagem ?? 'A nova palavra-passe não é válida.');
      else if (st === 429) setErro('Demasiadas tentativas. Tenta novamente dentro de 15 minutos.');
      else setErro('Não foi possível alterar a palavra-passe. Tenta novamente.');
    } finally {
      setAEnviar(false);
    }
  };

  if (!aberto) {
    return <Button variant="outline" className="w-full justify-start text-left h-12" data-testid="alterar-password-abrir" onClick={() => setAberto(true)}>Alterar Password</Button>;
  }
  return (
    <form onSubmit={submeter} className="space-y-4 border border-border rounded-xl p-4" data-testid="alterar-password-form" noValidate>
      <h3 className="font-bold">Alterar palavra-passe</h3>
      <div className="space-y-2">
        <Label htmlFor="pw-atual">Palavra-passe atual</Label>
        <Input id="pw-atual" type="password" autoComplete="current-password" value={atual} onChange={(e) => setAtual(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="pw-nova">Nova palavra-passe</Label>
        <Input id="pw-nova" type="password" autoComplete="new-password" value={nova} onChange={(e) => setNova(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="pw-confirmar">Confirma a nova palavra-passe</Label>
        <Input id="pw-confirmar" type="password" autoComplete="new-password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} />
      </div>
      {erro && <p role="alert" className="text-sm text-destructive" data-testid="alterar-password-erro">{erro}</p>}
      <div className="flex gap-3">
        <Button type="submit" disabled={aEnviar} className="bg-primary hover:bg-primary/90 text-white font-bold min-h-[44px]">{aEnviar && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Guardar</Button>
        <Button type="button" variant="outline" className="min-h-[44px]" onClick={fechar} disabled={aEnviar}>Cancelar</Button>
      </div>
    </form>
  );
}
