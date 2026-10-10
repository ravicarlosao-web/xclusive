import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { DataTable, Column } from '@/components/tables/DataTable';
import { StatusBadge } from '@/components/badges/StatusBadge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { CheckCircle2, XCircle, ThumbsUp, Eye } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export default function Withdrawals() {
  const [statusFilter, setStatusFilter] = useState('pendente');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: withdrawals, isLoading } = useQuery({
    queryKey: ['withdrawals', statusFilter],
    queryFn: () => adminApi.getWithdrawals(statusFilter !== 'all' ? { status: statusFilter } : undefined)
  });

  const updateWithdrawal = useMutation({
    mutationFn: ({ id, status, notes }: { id: number, status: string, notes?: string }) =>
      adminApi.updateWithdrawal(id, { status, ...(notes ? { notes } : {}) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['withdrawals'] });
      toast({ title: 'Levantamento atualizado' });
    },
    onError: (err: any) => {
      // 409 = transição inválida (outro admin já decidiu); recarrega a lista
      queryClient.invalidateQueries({ queryKey: ['withdrawals'] });
      toast({ title: 'Não foi possível atualizar', description: String(err?.message ?? '').slice(0, 200), variant: 'destructive' });
    }
  });

  // Dados de pagamento: só no detalhe de UM pedido; o servidor grava audit_log a cada visualização.
  const [details, setDetails] = useState<{ id: number; iban: string; nomeTitular: string; banco: string; amount: number } | null>(null);
  async function openDetails(id: number) {
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch('/api/admin/withdrawals/' + id, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const w = await res.json();
      setDetails({ id, amount: w.amount, iban: w.destinationDetails?.iban ?? '—', nomeTitular: w.destinationDetails?.nomeTitular ?? '—', banco: w.destinationDetails?.banco ?? '—' });
    } catch {
      toast({ title: 'Não foi possível obter os dados de pagamento', variant: 'destructive' });
    }
  }

  const columns: Column<any>[] = [
    { header: 'ID', accessorKey: 'id', className: 'w-16 font-mono text-muted-foreground' },
    { header: 'Criador', accessorKey: 'creatorUsername', className: 'font-medium text-primary' },
    { 
      header: 'Valor', 
      cell: (item) => <span className="font-bold font-mono">{Number(item.amount).toLocaleString('pt-PT')} Kz</span>
    },
    { 
      header: 'Método / Conta',
      cell: (item) => (
        <div className="flex items-center gap-2">
          <span className="text-sm">{item.method}</span>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => openDetails(item.id)}>
            <Eye className="h-3.5 w-3.5 mr-1" /> Ver dados
          </Button>
        </div>
      )
    },
    { 
      header: 'Data do Pedido', 
      cell: (item) => <span className="text-muted-foreground text-sm">{format(new Date(item.criadoEm), 'dd MMM yyyy')}</span>
    },
    { 
      header: 'Estado', 
      cell: (item) => <StatusBadge status={item.status} />
    },
    {
      header: 'Ações',
      className: 'text-right',
      cell: (item) => (
        <div className="flex justify-end gap-2">
          {item.status === 'pendente' && (
            <Button
              size="sm"
              variant="outline"
              className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10 h-8 px-2"
              disabled={updateWithdrawal.isPending}
              onClick={() => updateWithdrawal.mutate({ id: item.id, status: 'aprovado' })}
            >
              <ThumbsUp className="h-4 w-4 mr-1" /> Aprovar
            </Button>
          )}
          {item.status === 'aprovado' && (
            <Button
              size="sm"
              variant="outline"
              className="border-green-500/30 text-green-500 hover:bg-green-500/10 h-8 px-2"
              disabled={updateWithdrawal.isPending}
              onClick={() => {
                if (confirm('Marcar como pago? Confirma que já transferiste o valor. Este passo é irreversível.')) {
                  updateWithdrawal.mutate({ id: item.id, status: 'pago' });
                }
              }}
            >
              <CheckCircle2 className="h-4 w-4 mr-1" /> Marcar Pago
            </Button>
          )}
          {item.status === 'pendente' && (
            <Button
              size="sm"
              variant="outline"
              className="border-red-500/30 text-red-500 hover:bg-red-500/10 h-8 px-2"
              disabled={updateWithdrawal.isPending}
              onClick={() => {
                const reason = prompt('Motivo da rejeição (os ganhos voltam à criadora):');
                if (reason) {
                  updateWithdrawal.mutate({ id: item.id, status: 'rejeitado', notes: reason });
                }
              }}
            >
              <XCircle className="h-4 w-4 mr-1" /> Rejeitar
            </Button>
          )}
        </div>
      )
    }
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Levantamentos</h1>
          <p className="text-muted-foreground">Aprovação de pagamentos aos criadores.</p>
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px] bg-card">
            <SelectValue placeholder="Filtrar por estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="pendente">Pendentes</SelectItem>
            <SelectItem value="aprovado">Aprovados (a pagar)</SelectItem>
            <SelectItem value="pago">Pagos</SelectItem>
            <SelectItem value="rejeitado">Rejeitados</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable 
        columns={columns} 
        data={(withdrawals as any)?.data ?? withdrawals ?? []} 
        isLoading={isLoading}
      />

      <Dialog open={!!details} onOpenChange={(o) => { if (!o) setDetails(null); }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader><DialogTitle>Dados de pagamento · pedido #{details?.id}</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <div><p className="text-xs text-muted-foreground uppercase">Valor</p><p className="font-bold">{details ? Number(details.amount).toLocaleString('pt-PT') : ''} Kz</p></div>
            <div><p className="text-xs text-muted-foreground uppercase">Titular</p><p className="font-bold">{details?.nomeTitular}</p></div>
            <div><p className="text-xs text-muted-foreground uppercase">Banco</p><p className="font-bold">{details?.banco}</p></div>
            <div><p className="text-xs text-muted-foreground uppercase">IBAN</p><p className="font-bold font-mono tracking-wider select-all">{details?.iban}</p></div>
            <p className="text-xs text-muted-foreground">Esta consulta ficou registada no registo de auditoria.</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
