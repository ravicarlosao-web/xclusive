import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useBlockUser,
  useUnblockUser,
  getGetUserProfileQueryKey,
} from '@workspace/api-client-react';
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/** Texto de erro do servidor (campo `error`), ou o genérico. */
export function textoErroServidor(e: unknown, generico: string): string {
  const data = (e as { data?: { error?: unknown } } | null)?.data;
  return data && typeof data.error === 'string' && data.error ? data.error : generico;
}

/**
 * Bloquear/desbloquear: o bloqueio afeta SÓ mensagens e novas conversas (não cancela subscrições nem mexe em seguir).
 * Depois de cada ação invalida lista de conversas, contadores, lista de bloqueados e o perfil.
 */
export function useBloqueio() {
  const queryClient = useQueryClient();
  const bloquear = useBlockUser();
  const desbloquear = useUnblockUser();

  const atualizar = async (username: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['conversations'] }),
      // lista, contadores e mensagens (as chaves começam todas por /api/conversations)
      queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && q.queryKey[0].startsWith('/api/conversations') }),
      queryClient.invalidateQueries({ queryKey: ['/api/users/me/blocks'] }),
      queryClient.invalidateQueries({ queryKey: getGetUserProfileQueryKey(username) }),
    ]);
  };

  return {
    pendente: bloquear.isPending || desbloquear.isPending,
    bloquear: async (username: string) => { await bloquear.mutateAsync({ username }); await atualizar(username); },
    desbloquear: async (username: string) => { await desbloquear.mutateAsync({ username }); await atualizar(username); },
  };
}

/** Diálogo de confirmação (foco preso, Esc fecha) para bloquear ou desbloquear. */
export function BloqueioDialog({ aberto, modo, username, onFechar, onConcluido }: {
  aberto: boolean; modo: 'bloquear' | 'desbloquear'; username: string; onFechar: () => void; onConcluido?: () => void;
}) {
  const { bloquear, desbloquear, pendente } = useBloqueio();
  const [erro, setErro] = useState<string | null>(null);
  const bloqueio = modo === 'bloquear';

  const confirmar = async () => {
    setErro(null);
    try {
      if (bloqueio) await bloquear(username); else await desbloquear(username);
      onFechar();
      onConcluido?.();
    } catch (e) {
      setErro(textoErroServidor(e, bloqueio ? 'Não foi possível bloquear esta conta. Tenta novamente.' : 'Não foi possível desbloquear esta conta. Tenta novamente.'));
    }
  };

  return (
    <AlertDialog open={aberto} onOpenChange={(o) => { if (!o && !pendente) { setErro(null); onFechar(); } }}>
      <AlertDialogContent data-testid="bloqueio-dialogo">
        <AlertDialogHeader>
          <AlertDialogTitle>{bloqueio ? `Bloquear @${username}?` : `Desbloquear @${username}?`}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            {bloqueio ? (
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>@{username} deixa de poder enviar-te mensagens e a conversa deixa de aparecer na tua lista.</p>
                <p>As subscrições não são canceladas. Podes desbloquear a qualquer momento em Definições &gt; Privacidade.</p>
              </div>
            ) : (
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>@{username} volta a poder enviar-te mensagens (sujeito à tua definição de quem te pode escrever) e a conversa volta à tua lista.</p>
              </div>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {erro && <p role="alert" data-testid="bloqueio-erro" className="text-sm text-destructive">{erro}</p>}
        <AlertDialogFooter className="gap-2 sm:gap-2">
          <button type="button" onClick={() => { setErro(null); onFechar(); }} disabled={pendente} data-testid="bloqueio-cancelar"
            className="min-h-[44px] rounded-md border border-border bg-background px-4 text-sm font-semibold text-foreground transition-colors hover:bg-secondary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Cancelar
          </button>
          <button type="button" onClick={() => { void confirmar(); }} disabled={pendente} data-testid="bloqueio-confirmar"
            className={`min-h-[44px] rounded-md px-4 text-sm font-bold text-white transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${bloqueio ? 'bg-destructive hover:bg-destructive/90' : 'bg-primary hover:bg-primary/90'}`}>
            {pendente ? 'A guardar…' : bloqueio ? 'Bloquear' : 'Desbloquear'}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
