import { useEffect, useState } from 'react';
import { requestEmailVerification } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Loader2, MailCheck, MailWarning } from 'lucide-react';
import type { EstadoEmail } from '@/hooks/useEmailVerificado';

export const MSG_EMAIL_INDISPONIVEL = 'O envio de email está temporariamente indisponível. Tenta daqui a pouco.';

/**
 * Estado do email da conta e botão para enviar o email de verificação (POST /api/auth/verificar-email/pedir).
 * Mostra a contagem do intervalo mínimo entre reenvios e uma mensagem própria para cada resposta do servidor.
 */
export function VerificarEmail({ estado, aoAtualizar, aoVerificarOutraVez }: { estado: EstadoEmail; aoAtualizar?: () => void; aoVerificarOutraVez?: () => void }) {
  const [aEnviar, setAEnviar] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [espera, setEspera] = useState(0);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (espera <= 0) return;
    const id = window.setTimeout(() => setEspera((e) => e - 1), 1000);
    return () => window.clearTimeout(id);
  }, [espera]);

  const pedir = async () => {
    setErro(null); setAEnviar(true);
    try {
      const r = await requestEmailVerification();
      if (r?.jaVerificado) { aoAtualizar?.(); return; }
      setEnviado(true); setEspera(60);
    } catch (err) {
      const e2 = err as { status?: number; data?: { codigo?: string; esperarSegundos?: number } } | null;
      const cod = e2?.data?.codigo;
      if (e2?.status === 503 || cod === 'email_indisponivel') setErro(MSG_EMAIL_INDISPONIVEL);
      else if (cod === 'demasiado_cedo') { setEspera(e2?.data?.esperarSegundos ?? 60); setErro('Já enviámos um email há pouco. Aguarda um momento antes de pedires outro.'); }
      else if (cod === 'limite_hora' || e2?.status === 429) setErro('Já enviámos vários emails para este endereço. Tenta novamente dentro de uma hora.');
      else setErro('Não foi possível enviar o email. Tenta novamente.');
    } finally {
      setAEnviar(false);
    }
  };

  if (estado === 'carregando') return <p className="text-sm text-muted-foreground" data-testid="email-estado">A verificar o estado do email…</p>;
  if (estado === 'verificado') {
    return (
      <p className="flex items-center gap-2 text-sm" data-testid="email-estado"><MailCheck className="w-5 h-5 text-primary" aria-hidden="true" /> O teu email está verificado.</p>
    );
  }
  return (
    <div className="space-y-3" data-testid="email-verificar">
      <p className="flex items-center gap-2 text-sm" data-testid="email-estado"><MailWarning className="w-5 h-5 text-amber-700 dark:text-amber-400" aria-hidden="true" /> O teu email ainda não está verificado.</p>
      {enviado && (
        <p role="status" className="text-sm text-muted-foreground" data-testid="email-enviado">
          Enviámos um email de verificação. Abre a ligação para confirmar (verifica também a pasta de spam).{' '}
          {aoVerificarOutraVez && <button type="button" className="inline-flex items-center min-h-[44px] text-primary underline" onClick={aoVerificarOutraVez} data-testid="email-ja-verifiquei">Já verifiquei</button>}
        </p>
      )}
      {erro && <p role="alert" className="text-sm text-destructive" data-testid="email-erro">{erro}</p>}
      <Button type="button" variant="outline" className="w-full h-12" onClick={pedir} disabled={aEnviar || espera > 0} data-testid="email-pedir">
        {aEnviar ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : espera > 0 ? `Reenviar em ${espera} s` : enviado ? 'Reenviar email de verificação' : 'Enviar email de verificação'}
      </Button>
    </div>
  );
}
