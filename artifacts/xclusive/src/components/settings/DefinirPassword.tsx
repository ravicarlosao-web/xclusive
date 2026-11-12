import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useGetGoogleStatus, getGetGoogleStatusQueryKey, forgotPassword } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';

/**
 * Para contas criadas com o Google, que ainda não têm palavra-passe: «Alterar» exige a palavra-passe atual, que não existe. Em vez disso envia-se o email
 * de recuperação de palavra-passe (o endereço da conta é o do Google, o único com que estas contas são criadas) e a pessoa define-a pela ligação.
 */
export function DefinirPassword() {
  const estado = useGetGoogleStatus({ query: { queryKey: getGetGoogleStatusQueryKey(), retry: false, staleTime: 60_000 } });
  const [aEnviar, setAEnviar] = useState(false);
  const [resultado, setResultado] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const email = estado.data?.email ?? null;

  const enviar = async () => {
    if (!email) return;
    setAEnviar(true); setResultado(null);
    try {
      const r = await forgotPassword({ email });
      setResultado({ tipo: 'ok', texto: r?.mensagem ?? 'Enviámos as instruções para o teu email.' });
    } catch (e) {
      setResultado({ tipo: 'erro', texto: (e as { status?: number } | null)?.status === 429 ? 'Demasiados pedidos. Tenta novamente dentro de 15 minutos.' : 'Não foi possível enviar o email. Tenta novamente.' });
    } finally { setAEnviar(false); }
  };

  return (
    <section className="border border-border rounded-xl p-4 space-y-3" aria-label="Palavra-passe" data-testid="bloco-definir-password">
      <h3 className="font-bold">Palavra-passe</h3>
      <p className="text-sm text-muted-foreground">Esta conta foi criada com o Google e ainda não tem palavra-passe. Define uma: enviamos-te um email com a ligação.</p>
      <Button variant="outline" className="w-full justify-start text-left h-12" onClick={() => { void enviar(); }} disabled={aEnviar || !email} data-testid="definir-password">
        {aEnviar && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Definir palavra-passe
      </Button>
      {resultado && <p role={resultado.tipo === 'erro' ? 'alert' : 'status'} className={resultado.tipo === 'erro' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'} data-testid="definir-password-resultado">{resultado.texto}</p>}
    </section>
  );
}
