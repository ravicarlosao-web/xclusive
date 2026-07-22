import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRoute, useLocation } from 'wouter';
import { adminApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { StatusBadge } from '@/components/badges/StatusBadge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Ban, ShieldAlert, Trash2, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

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
          {isSuspended ? (
            <Button variant="outline" className="border-green-500/50 text-green-500 hover:bg-green-500/10" onClick={() => updateStatus.mutate('ativo')}>
              <CheckCircle2 className="mr-2 h-4 w-4" /> Reactivar Conta
            </Button>
          ) : (
            <Button variant="outline" className="border-yellow-500/50 text-yellow-500 hover:bg-yellow-500/10" onClick={() => updateStatus.mutate('suspenso')}>
              <Ban className="mr-2 h-4 w-4" /> Suspender
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
                <p className="text-lg">{format(new Date(user.joinedAt), 'dd MMM yyyy, HH:mm')}</p>
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
                    <p className="text-3xl font-bold text-primary">{user.balance?.toLocaleString()} MZN</p>
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
            <div className="flex items-center justify-center p-8 border border-dashed border-border rounded-lg bg-muted/10">
              <div className="text-center">
                <ShieldAlert className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                <h3 className="text-lg font-medium">Nenhum alerta de moderação</h3>
                <p className="text-sm text-muted-foreground">Este utilizador não tem reports pendentes.</p>
              </div>
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
