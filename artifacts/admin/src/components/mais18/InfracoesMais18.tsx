import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { ShieldAlert } from 'lucide-react';
import { LIMITE_SUSPENSAO } from './AcoesMais18';

const TIPO_LABEL: Record<string, string> = { post: 'Publicação', reel: 'Reel', story: 'Story', live: 'Live' };

/** Separador "Moderação" do utilizador: infrações da regra do +18 (ativas e anuladas), contagem e anulação. */
export function InfracoesMais18({ userId }: { userId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [alvo, setAlvo] = useState<{ id: number; numero: number } | null>(null);
  const [motivo, setMotivo] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['infracoes-mais18', userId],
    queryFn: () => adminApi.getInfracoesMais18(userId),
  });

  const anular = useMutation({
    mutationFn: () => adminApi.anularInfracaoMais18(alvo!.id, motivo.trim()),
    onSuccess: (r: any) => {
      toast({ title: 'Infração anulada', description: `A criadora tem agora ${r.ativas} infração(ões) ativa(s).` });
      setAlvo(null); setMotivo('');
      queryClient.invalidateQueries({ queryKey: ['infracoes-mais18'] });
    },
    onError: (e: any) => toast({ title: 'Não foi possível anular', description: String(e?.message ?? '').slice(0, 300), variant: 'destructive' }),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">A carregar infrações…</p>;
  if (error) return <p className="text-sm text-red-400" data-testid="infracoes-erro">{String((error as Error).message)}</p>;
  const lista: any[] = data?.infracoes ?? [];

  return (
    <div className="space-y-4" data-testid="painel-infracoes">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border p-4">
        <ShieldAlert className="h-6 w-6 text-muted-foreground" />
        <div>
          <p className="font-medium">Infrações da regra do +18</p>
          <p className="text-sm text-muted-foreground">
            Ativas: <strong data-testid="contagem-ativas">{data?.ativas ?? 0}</strong> de {LIMITE_SUSPENSAO} · Total registadas: <span data-testid="contagem-total">{data?.total ?? 0}</span>.
            {' '}A {LIMITE_SUSPENSAO}.ª infração ativa suspende a conta; os avisos não caducam e só o admin os pode anular.
          </p>
        </div>
      </div>

      {lista.length === 0 ? (
        <div className="flex items-center justify-center p-8 border border-dashed border-border rounded-lg bg-muted/10">
          <p className="text-sm text-muted-foreground" data-testid="sem-infracoes">Nenhuma infração +18 registada para este utilizador.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-left text-xs uppercase text-muted-foreground">
              <tr><th className="p-2">Nº</th><th className="p-2">Conteúdo</th><th className="p-2">Ação</th><th className="p-2">Data</th><th className="p-2">Origem / motivo</th><th className="p-2">Estado</th><th className="p-2" /></tr>
            </thead>
            <tbody>
              {lista.map((i) => (
                <tr key={i.id} className="border-t" data-testid={`infracao-${i.id}`}>
                  <td className="p-2 font-mono">{i.numero}</td>
                  <td className="p-2">{TIPO_LABEL[i.tipoConteudo] ?? i.tipoConteudo} #{i.conteudoId}</td>
                  <td className="p-2">
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium uppercase ${i.acao === 'suspensao' ? 'border-red-500/30 bg-red-500/10 text-red-400' : 'border-yellow-500/30 bg-yellow-500/10 text-yellow-400'}`}>
                      {i.acao === 'suspensao' ? 'Suspensão' : 'Aviso'}
                    </span>
                  </td>
                  <td className="p-2 text-muted-foreground">{format(new Date(i.criadaEm), 'dd MMM yyyy, HH:mm')}</td>
                  <td className="p-2 text-muted-foreground">{i.origem === 'denuncia' ? `Denúncia #${i.reportId ?? '—'}` : 'Admin'}{i.motivo ? ` · ${i.motivo}` : ''}</td>
                  <td className="p-2">
                    {i.anulada ? (
                      <span className="text-muted-foreground" data-testid={`anulada-${i.id}`}>
                        Anulada por admin #{i.anulada.por} em {format(new Date(i.anulada.em), 'dd MMM yyyy, HH:mm')} — {i.anulada.motivo}
                      </span>
                    ) : <strong className="text-red-400">Ativa</strong>}
                  </td>
                  <td className="p-2 text-right">
                    {!i.anulada && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" data-testid={`anular-${i.id}`} onClick={() => setAlvo({ id: i.id, numero: i.numero })}>Anular</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!alvo} onOpenChange={(o) => { if (!o && !anular.isPending) { setAlvo(null); setMotivo(''); } }}>
        <DialogContent className="sm:max-w-[460px]" data-testid="dialogo-anular">
          <DialogHeader>
            <DialogTitle>Anular a infração nº {alvo?.numero}</DialogTitle>
            <DialogDescription>Fica registada com o teu nome, a data e o motivo, e deixa de contar. Não reativa a conta.</DialogDescription>
          </DialogHeader>
          <textarea className="w-full rounded-md border bg-background px-3 py-2 min-h-[70px] text-sm" placeholder="Motivo da anulação (obrigatório)"
            maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} data-testid="motivo-anular" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setAlvo(null); setMotivo(''); }} disabled={anular.isPending}>Cancelar</Button>
            <Button variant="destructive" disabled={anular.isPending || !motivo.trim()} data-testid="confirmar-anular" onClick={() => anular.mutate()}>Anular infração</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
