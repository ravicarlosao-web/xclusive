import { useState } from 'react';
import { Link } from 'wouter';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { getBlockedUsers, useUpdateProfile, type UserProfile, type ProfileUpdateQuemPodeEscrever } from '@workspace/api-client-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useBloqueio, textoErroServidor } from './bloqueio';

type Regra = ProfileUpdateQuemPodeEscrever;
const OPCOES: { valor: Regra; rotulo: string; texto: string }[] = [
  { valor: 'todos', rotulo: 'Todos', texto: 'Qualquer pessoa te pode enviar mensagens.' },
  { valor: 'seguidores_assinantes', rotulo: 'Seguidores e assinantes', texto: 'Só quem te segue ou subscreve te pode iniciar uma conversa.' },
  { valor: 'assinantes', rotulo: 'Só assinantes', texto: 'Só quem subscreve te pode enviar mensagens.' },
];

/** Definições > Privacidade (só criadores): quem pode enviar-te mensagens. Guarda por PATCH /users/me; estado vem de /auth/me. */
export function QuemPodeEscrever({ atual }: { atual: Regra | undefined }) {
  const queryClient = useQueryClient();
  const atualizar = useUpdateProfile();
  const [valor, setValor] = useState<Regra>(atual ?? 'todos');
  const [estado, setEstado] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  const mudar = async (novo: string) => {
    const anterior = valor;
    const v = novo as Regra;
    setValor(v);
    setEstado(null);
    try {
      await atualizar.mutateAsync({ data: { quemPodeEscrever: v } });
      // mantém /auth/me em dia (a definição aparece igual ao voltar a esta página)
      queryClient.setQueryData(['/api/auth/me'], (old: UserProfile | undefined) => (old ? { ...old, quemPodeEscrever: v } : old));
      setEstado({ tipo: 'ok', texto: 'Guardado.' });
    } catch (e) {
      setValor(anterior);
      setEstado({ tipo: 'erro', texto: textoErroServidor(e, 'Não foi possível guardar. Tenta novamente.') });
    }
  };

  return (
    <section aria-labelledby="quem-escreve-titulo" className="space-y-3" data-testid="quem-escreve">
      <h3 id="quem-escreve-titulo" className="text-base font-bold">Quem pode enviar-te mensagens</h3>
      <RadioGroup value={valor} onValueChange={(v) => { void mudar(v); }} aria-labelledby="quem-escreve-titulo" disabled={atualizar.isPending} className="gap-2">
        {OPCOES.map((o) => (
          <Label key={o.valor} htmlFor={`quem-${o.valor}`} data-testid={`quem-opcao-${o.valor}`}
            className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-xl border border-border p-4 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
            <RadioGroupItem id={`quem-${o.valor}`} value={o.valor} className="mt-0.5" />
            <span className="space-y-0.5">
              <span className="block text-sm font-bold">{o.rotulo}</span>
              <span className="block text-sm font-normal text-muted-foreground">{o.texto}</span>
            </span>
          </Label>
        ))}
      </RadioGroup>
      <p role={estado?.tipo === 'erro' ? 'alert' : 'status'} data-testid="quem-estado" className={`min-h-[1.25rem] text-sm ${estado?.tipo === 'erro' ? 'text-destructive' : 'text-muted-foreground'}`}>{estado?.texto ?? ''}</p>
    </section>
  );
}

/** Definições > Privacidade (todos): contas bloqueadas, com desbloquear. */
export function ContasBloqueadas() {
  const { desbloquear } = useBloqueio();
  const [aDesbloquear, setADesbloquear] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const q = useInfiniteQuery({
    // começa por /api/users/me/blocks: o desbloqueio (useBloqueio) invalida-a
    queryKey: ['/api/users/me/blocks', 'lista'],
    queryFn: ({ pageParam }) => getBlockedUsers({ page: pageParam, limit: 20 }),
    initialPageParam: 1,
    getNextPageParam: (ultima) => (ultima?.hasMore ? ultima.page + 1 : undefined),
  });
  const contas = q.data?.pages.flatMap((p) => p.users ?? []) ?? [];

  const tirar = async (username: string) => {
    setADesbloquear(username);
    setErro(null);
    try { await desbloquear(username); } catch (e) { setErro(textoErroServidor(e, 'Não foi possível desbloquear. Tenta novamente.')); } finally { setADesbloquear(null); }
  };

  return (
    <section aria-labelledby="bloqueados-titulo" className="space-y-3" data-testid="contas-bloqueadas">
      <h3 id="bloqueados-titulo" className="text-base font-bold">Contas bloqueadas</h3>
      <p className="text-sm text-muted-foreground">Quem bloqueias não te pode enviar mensagens e as vossas conversas deixam de aparecer na tua lista.</p>
      {erro && <p role="alert" data-testid="bloqueados-erro-acao" className="text-sm text-destructive">{erro}</p>}
      {q.isLoading ? (
        <div aria-busy="true" aria-label="A carregar as contas bloqueadas" data-testid="bloqueados-carregar" className="space-y-2">
          {[0, 1].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
        </div>
      ) : q.isError ? (
        <div role="alert" data-testid="bloqueados-erro" className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
          <p className="mb-2">Não foi possível carregar as contas bloqueadas.</p>
          <button type="button" onClick={() => { void q.refetch(); }} className="min-h-[44px] rounded-md px-3 font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Tentar novamente</button>
        </div>
      ) : contas.length === 0 ? (
        <p data-testid="bloqueados-vazio" className="rounded-xl border border-border p-4 text-sm text-muted-foreground">Não bloqueaste ninguém.</p>
      ) : (
        <ul className="space-y-2" data-testid="bloqueados-lista">
          {contas.map((u) => (
            <li key={u.id} data-testid="bloqueado-item" className="flex items-center gap-3 rounded-xl border border-border p-3">
              <Link href={`/perfil/${u.username}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Avatar className="h-10 w-10 shrink-0 border border-border">
                  <AvatarImage src={u.avatarUrl ?? ''} />
                  <AvatarFallback>{(u.nomeExibicao ?? u.username)[0]?.toUpperCase()}</AvatarFallback>
                </Avatar>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-bold">{u.nomeExibicao}</span>
                  <span className="truncate text-xs text-muted-foreground">@{u.username}</span>
                </span>
              </Link>
              <button type="button" data-testid="bloqueado-desbloquear" aria-label={`Desbloquear @${u.username}`} disabled={aDesbloquear === u.username} onClick={() => { void tirar(u.username); }}
                className="min-h-[44px] shrink-0 rounded-full border border-border bg-background px-4 text-sm font-semibold text-foreground transition-colors hover:bg-secondary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {aDesbloquear === u.username ? 'A desbloquear…' : 'Desbloquear'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.hasNextPage && (
        <button type="button" data-testid="bloqueados-mais" onClick={() => { void q.fetchNextPage(); }} disabled={q.isFetchingNextPage}
          className="min-h-[44px] rounded-md px-3 text-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{q.isFetchingNextPage ? 'A carregar…' : 'Carregar mais'}</button>
      )}
    </section>
  );
}
