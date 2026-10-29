import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRoute, useLocation } from 'wouter';
import { adminApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { StatusBadge } from '@/components/badges/StatusBadge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Ban, Trash2, CheckCircle2, RotateCcw, ShieldX } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { InfracoesMais18 } from '@/components/mais18/InfracoesMais18';

export default function UserDetail() {
  const [, params] = useRoute('/users/:id');
  const [, setLocation] = useLocation();
  const id = parseInt(params?.id || '0');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: user, isLoading } = useQuery({
    queryKey: ['user', id],
    queryFn: () => adminApi.getUser(id),
    enabled: !!id
  });

  const updateStatus = useMutation({
    mutationFn: (estado: string) => adminApi.updateUserStatus(id, estado),
    onSuccess: (_, variables) => {
      queryClient.setQueryData(['user', id], (old: any) => old ? { ...old, estado: variables } : old);
      toast({ title: 'Estado atualizado com sucesso' });
    }
  });

  // Conta encerrada pelo próprio utilizador: só se reabre (dentro dos 30 dias), com motivo obrigatório.
  const reabrir = useMutation({
    mutationFn: async (motivo: string) => {
      const token = localStorage.getItem('admin_token');
      const res = await fetch(`/api/admin/users/${id}/reabrir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: JSON.stringify({ motivo }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user', id] });
      toast({ title: 'Conta reaberta' });
    },
    onError: (e: Error) => toast({ variant: 'destructive', title: 'Não foi possível reabrir a conta', description: e.message }),
  });

  // Banimento permanente: motivo obrigatório (10 a 500) e confirmação reforçada (escrever o username).
  const [banirAberto, setBanirAberto] = useState(false);
  const [banirMotivo, setBanirMotivo] = useState('');
  const [banirConfirma, setBanirConfirma] = useState('');
  const banir = useMutation({
    mutationFn: async (motivo: string) => {
      const token = localStorage.getItem('admin_token');
      const res = await fetch(`/api/admin/users/${id}/banir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: JSON.stringify({ motivo }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      return json;
    },
    onSuccess: () => {
      setBanirAberto(false); setBanirMotivo(''); setBanirConfirma('');
      queryClient.invalidateQueries({ queryKey: ['user', id] });
      toast({ title: 'Conta banida de forma permanente' });
    },
    onError: (e: Error) => toast({ variant: 'destructive', title: 'Não foi possível banir a conta', description: e.message }),
  });

  const deleteUser = useMutation({
    mutationFn: () => adminApi.deleteUser(id),
    onSuccess: () => {
      toast({ title: 'Utilizador eliminado com sucesso' });
      setLocation('/users');
    }
  });

  if (isLoading) return <div>A carregar...</div>;
  if (!user) return <div>Utilizador não encontrado</div>;

  const isSuspended = user.estado === 'suspenso';
  const isEncerrada = user.estado === 'encerrada';
  const isBanida = user.estado === 'banida';
  const motivoBanirOk = banirMotivo.trim().length >= 10 && banirMotivo.trim().length <= 500;
  const podeBanir = motivoBanirOk && banirConfirma.trim() === user.username && !banir.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation('/users')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{user.username}</h1>
            <StatusBadge status={user.estado} />
            {user.role === 'creator' && <span className="bg-primary/20 text-primary px-2 py-1 rounded-md text-xs font-bold uppercase">Criador</span>}
          </div>
          <p className="text-muted-foreground">{user.email} • ID: {user.id}</p>
        </div>
        
        <div className="flex items-center gap-2">
          {isBanida ? (
            <span className="text-xs text-muted-foreground max-w-[14rem]" data-testid="conta-banida-aviso">Conta banida de forma permanente. Não se reabre nem se reativa.</span>
          ) : isEncerrada ? (
            user.encerramento?.podeReabrir ? (
              <Button variant="outline" className="border-green-500/50 text-green-500 hover:bg-green-500/10" onClick={() => {
                const motivo = (prompt('Motivo da reabertura (obrigatório, mínimo 10 caracteres; fica registado):') ?? '').trim();
                if (!motivo) return;
                if (motivo.length < 10) { toast({ variant: 'destructive', title: 'Motivo demasiado curto', description: 'Indica um motivo com pelo menos 10 caracteres.' }); return; }
                reabrir.mutate(motivo);
              }}>
                <RotateCcw className="mr-2 h-4 w-4" /> Reabrir conta
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground max-w-[14rem]">Conta encerrada pelo utilizador. A janela de reabertura terminou.</span>
            )
          ) : isSuspended ? (
            <Button variant="outline" className="border-green-500/50 text-green-500 hover:bg-green-500/10" onClick={() => updateStatus.mutate('ativo')}>
              <CheckCircle2 className="mr-2 h-4 w-4" /> Reactivar Conta
            </Button>
          ) : (
            <Button variant="outline" className="border-yellow-500/50 text-yellow-500 hover:bg-yellow-500/10" onClick={() => updateStatus.mutate('suspenso')}>
              <Ban className="mr-2 h-4 w-4" /> Suspender
            </Button>
          )}
          {!isBanida && user.role !== 'admin' && user.role !== 'superadmin' && (
            <Button variant="outline" className="border-red-700/60 text-red-400 hover:bg-red-500/10" data-testid="banir-abrir" onClick={() => setBanirAberto(true)}>
              <ShieldX className="mr-2 h-4 w-4" /> Banir permanentemente
            </Button>
          )}
          <Button variant="destructive" onClick={() => {
            if(confirm('Tem a certeza que deseja eliminar este utilizador permanentemente?')) {
              deleteUser.mutate();
            }
          }}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Dialog open={banirAberto} onOpenChange={(o) => { if (!banir.isPending) { setBanirAberto(o); if (!o) { setBanirMotivo(''); setBanirConfirma(''); } } }}>
        <DialogContent data-testid="banir-dialogo">
          <DialogHeader>
            <DialogTitle>Banir @{user.username} permanentemente</DialogTitle>
            <DialogDescription>
              Isto é definitivo: a conta fica inacessível, as sessões terminam, e o email e o documento de identificação ficam bloqueados para novos registos. Não se pode desfazer por aqui.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="banir-motivo">Motivo (obrigatório, 10 a 500 caracteres; fica registado)</Label>
              <Textarea id="banir-motivo" data-testid="banir-motivo" value={banirMotivo} maxLength={500} onChange={(e) => setBanirMotivo(e.target.value)} rows={4} />
              <p className="text-xs text-muted-foreground">{banirMotivo.trim().length}/500</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="banir-confirma">Para confirmar, escreve o username: <strong>{user.username}</strong></Label>
              <Input id="banir-confirma" data-testid="banir-confirma" value={banirConfirma} autoComplete="off" onChange={(e) => setBanirConfirma(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBanirAberto(false)} disabled={banir.isPending}>Cancelar</Button>
            <Button variant="destructive" className="bg-red-700 hover:bg-red-800 text-white" data-testid="banir-confirmar" disabled={!podeBanir} onClick={() => banir.mutate(banirMotivo.trim())}>
              Banir permanentemente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Tabs defaultValue="perfil" className="w-full">
        <TabsList className="bg-card border border-border h-12 w-full justify-start rounded-none border-b-0 px-2">
          <TabsTrigger value="perfil">Perfil</TabsTrigger>
          <TabsTrigger value="actividade">Actividade</TabsTrigger>
          <TabsTrigger value="financeiro">Financeiro</TabsTrigger>
          <TabsTrigger value="moderacao">Moderação</TabsTrigger>
        </TabsList>
        
        <div className="border border-border bg-card p-6 rounded-b-lg">
          <TabsContent value="perfil" className="m-0 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-1">País de Registo</h3>
                <p className="text-lg">{user.pais}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-1">Data de Registo</h3>
                <p className="text-lg">{format(new Date(user.criadoEm), 'dd MMM yyyy, HH:mm')}</p>
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="actividade" className="m-0">
            <div className="text-center py-10 text-muted-foreground">
              Histórico de atividade (Em desenvolvimento)
            </div>
          </TabsContent>

          <TabsContent value="financeiro" className="m-0">
            {user.role === 'creator' ? (
              <div className="space-y-4">
                <Card className="bg-muted/30">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Saldo Atual</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold text-primary">{user.saldo?.toLocaleString()} Kz</p>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <div className="text-center py-10 text-muted-foreground">
                Dados financeiros apenas disponíveis para criadores.
              </div>
            )}
          </TabsContent>

          <TabsContent value="moderacao" className="m-0">
            <InfracoesMais18 userId={id} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
