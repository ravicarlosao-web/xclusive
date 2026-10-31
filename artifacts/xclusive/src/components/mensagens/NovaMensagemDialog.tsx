import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getUserFollowing, useCreateConversation, getGetConversationsQueryKey, type Conversation, type UserSummary } from '@workspace/api-client-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { textoErroServidor } from './bloqueio';

const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Nova mensagem: escolhe um destinatário entre as pessoas que segues (pedido só ao abrir, sem polling)
 * e abre a conversa (existente ou nova) no painel da direita.
 */
export function NovaMensagemDialog({ open, onClose, conversas }: { open: boolean; onClose: () => void; conversas: Conversation[] }) {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [termo, setTermo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const criar = useCreateConversation();

  const username = user?.username ?? '';
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['/api/users', username, 'following', 'nova-mensagem'],
    queryFn: () => getUserFollowing(username),
    enabled: open && !!username,
  });

  const pessoas = useMemo(() => {
    const t = norm(termo.trim());
    const todas = data?.users ?? [];
    return t ? todas.filter((u) => norm(`${u.nomeExibicao ?? ''} ${u.username}`).includes(t)) : todas;
  }, [data, termo]);

  const escolher = async (u: UserSummary) => {
    if (criar.isPending) return;
    setErro(null);
    const existente = conversas.find((c) => c.participantes.some((p) => p.id === u.id));
    try {
      const id = existente ? existente.id : (await criar.mutateAsync({ data: { participanteId: u.id } })).id;
      if (!existente) void queryClient.invalidateQueries({ queryKey: getGetConversationsQueryKey() });
      setTermo('');
      onClose();
      setLocation(`/mensagens/${id}`);
    } catch (e) {
      // 403 mensagens_restritas e 404 trazem o texto do servidor; o resto, o genérico
      const st = (e as { status?: number } | null)?.status;
      setErro(st === 403 || st === 404 ? textoErroServidor(e, 'Não foi possível abrir a conversa. Tenta novamente.') : 'Não foi possível abrir a conversa. Tenta novamente.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setTermo(''); setErro(null); onClose(); } }}>
      <DialogContent className="max-w-md" data-testid="nova-mensagem">
        <DialogHeader>
          <DialogTitle>Nova mensagem</DialogTitle>
          <DialogDescription>Escolhe para quem queres enviar a mensagem.</DialogDescription>
        </DialogHeader>
        <Input value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Pesquisar…" aria-label="Pesquisar destinatário" className="min-h-[44px]" data-testid="nova-mensagem-pesquisa" />
        {erro && <p role="alert" data-testid="nova-mensagem-erro" className="text-sm text-destructive">{erro}</p>}
        <div className="max-h-[50vh] overflow-y-auto" data-testid="nova-mensagem-lista">
          {isLoading && <p className="py-6 text-center text-sm text-muted-foreground">A carregar…</p>}
          {isError && (
            <div role="alert" className="py-6 text-center text-sm text-muted-foreground">
              <p className="mb-2">Não foi possível carregar as pessoas que segues.</p>
              <button type="button" className="min-h-[44px] rounded-md px-3 font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { void refetch(); }}>Tentar novamente</button>
            </div>
          )}
          {!isLoading && !isError && pessoas.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">{termo ? 'Ninguém encontrado.' : 'Ainda não segues ninguém.'}</p>
          )}
          {pessoas.map((u) => (
            <button key={u.id} type="button" onClick={() => { void escolher(u); }} disabled={criar.isPending} data-testid="nova-mensagem-pessoa"
              className="flex min-h-[56px] w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
              <Avatar className="h-10 w-10 border border-border">
                <AvatarImage src={u.avatarUrl ?? ''} />
                <AvatarFallback>{(u.nomeExibicao ?? u.username ?? '?')[0].toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-bold">{u.nomeExibicao ?? u.username}</span>
                <span className="truncate text-xs text-muted-foreground">@{u.username}</span>
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
