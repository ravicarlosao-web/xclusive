import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Save } from 'lucide-react';

interface ContaEstado {
  existe: boolean; ativa: boolean; valida: boolean; motivo: string | null;
  username?: string; tipoConta?: string; verificado?: boolean;
  boasVindas?: { podeConfigurar: boolean; configurada: boolean; ativa: boolean; desativadaPorAdmin: boolean; temImagem: boolean };
}
interface ContaOficial { ativo: boolean; username: string; conta: ContaEstado; boasVindasPlataformaAtiva: boolean }

/** Texto do estado da mensagem de boas-vindas da conta oficial (só leitura). */
function textoBoasVindas(c: ContaEstado, plataformaAtiva: boolean): string {
  const b = c.boasVindas;
  if (!b) return '';
  const base = !b.podeConfigurar ? 'A conta não é uma criadora verificada: não pode ter mensagem de boas-vindas.'
    : b.desativadaPorAdmin ? 'Mensagem de boas-vindas: desativada pela plataforma.'
    : !b.configurada ? 'Mensagem de boas-vindas: ainda não configurada.'
    : b.ativa ? 'Mensagem de boas-vindas: configurada e ativa.' : 'Mensagem de boas-vindas: configurada, mas desativada.';
  return plataformaAtiva ? base : `${base} (O interruptor geral das mensagens automáticas está desligado: nada é enviado.)`;
}

export function ContaOficialCard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading, isError } = useQuery<ContaOficial>({ queryKey: ['conta-oficial'], queryFn: () => adminApi.getContaOficial() });
  const [ativo, setAtivo] = useState(false);
  const [username, setUsername] = useState('');
  const [erro, setErro] = useState('');
  const [iniciado, setIniciado] = useState(false);

  useEffect(() => {
    if (data && !iniciado) { setAtivo(data.ativo); setUsername(data.username); setIniciado(true); }
  }, [data, iniciado]);

  const guardar = useMutation({
    mutationFn: () => adminApi.updateContaOficial({ ativo, username: username.trim() }),
    onSuccess: (r: ContaOficial) => {
      setErro(''); setAtivo(r.ativo); setUsername(r.username);
      queryClient.setQueryData(['conta-oficial'], r);
      toast({ title: 'Conta oficial guardada com sucesso' });
    },
    onError: (err: any) => {
      let msg = 'Não foi possível guardar a conta oficial.';
      try { msg = JSON.parse(err.message)?.error ?? msg; } catch { /* mensagem simples */ }
      setErro(msg);
      toast({ title: 'Erro', description: msg, variant: 'destructive' });
    },
  });

  const alterado = !!data && (ativo !== data.ativo || username.trim().toLowerCase() !== data.username);
  const c = data?.conta;

  return (
    <Card className="border-border" data-testid="conta-oficial">
      <CardHeader>
        <CardTitle>Conta oficial</CardTitle>
        <CardDescription>A conta oficial da plataforma. Quando ligado, as contas novas passam a segui-la ao registar-se (só contas novas; podem deixar de a seguir e nunca voltam a segui-la sozinhas).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-muted-foreground" role="status">A carregar…</p>}
        {isError && <p className="text-sm text-destructive" role="alert" data-testid="conta-oficial-erro-carregar">Não foi possível carregar a conta oficial.</p>}
        {data && (
          <>
            <div className="flex items-center justify-between border border-border p-4 rounded-lg bg-card/50">
              <div className="space-y-0.5 pr-4">
                <Label className="text-base" htmlFor="seguir-oficial-ativo">Seguir automaticamente a conta oficial ao criar conta</Label>
                <p className="text-sm text-muted-foreground" data-testid="conta-oficial-estado-interruptor">
                  {ativo ? 'Ligado: as contas novas seguem a conta oficial.' : 'Desligado: o registo não faz nada extra.'}
                </p>
              </div>
              <Switch id="seguir-oficial-ativo" data-testid="seguir-oficial-ativo" checked={ativo} onCheckedChange={setAtivo} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="conta-oficial-username">Username da conta oficial</Label>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground font-mono" aria-hidden="true">@</span>
                <Input id="conta-oficial-username" data-testid="conta-oficial-username" value={username} maxLength={50} autoComplete="off" spellCheck={false}
                  onChange={(e) => { setUsername(e.target.value); setErro(''); }} className="bg-card font-mono max-w-xs" aria-describedby="conta-oficial-estado" />
              </div>
              <div id="conta-oficial-estado" data-testid="conta-oficial-estado" className="space-y-1 text-sm">
                {c && !c.existe && <p className="text-destructive" role="status">A conta «{data.username}» não existe.</p>}
                {c && c.existe && !c.valida && <p className="text-destructive" role="status">{c.motivo}</p>}
                {c && c.existe && c.valida && <p className="text-foreground" role="status" data-testid="conta-oficial-valida">Conta «{c.username}» encontrada e ativa ({c.tipoConta === 'criador' ? (c.verificado ? 'criadora verificada' : 'criadora não verificada') : 'conta pessoal'}).</p>}
                {c && c.existe && <p className="text-muted-foreground" data-testid="conta-oficial-boas-vindas">{textoBoasVindas(c, data.boasVindasPlataformaAtiva)}</p>}
              </div>
            </div>

            {erro && <p className="text-sm text-destructive" role="alert" data-testid="conta-oficial-erro">{erro}</p>}
            <div className="flex justify-end">
              <Button type="button" id="save-conta-oficial" data-testid="conta-oficial-guardar" onClick={() => guardar.mutate()} disabled={!alterado || guardar.isPending || username.trim() === ''} className="w-full sm:w-auto">
                <Save className="mr-2 h-5 w-5" /> {guardar.isPending ? 'A guardar…' : 'Guardar conta oficial'}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
