import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { DataTable, Column } from '@/components/tables/DataTable';
import { StatusBadge } from '@/components/badges/StatusBadge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { CheckCircle2, XCircle } from 'lucide-react';

export default function Withdrawals() {
  const [statusFilter, setStatusFilter] = useState('pendente');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: withdrawals, isLoading } = useQuery({
    queryKey: ['withdrawals', statusFilter],
    queryFn: () => adminApi.getWithdrawals(statusFilter !== 'all' ? { status: statusFilter } : undefined)
  });

  const updateWithdrawal = useMutation({
    mutationFn: ({ id, status }: { id: number, status: string }) => adminApi.updateWithdrawal(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['withdrawals'] });
      toast({ title: 'Levantamento atualizado' });
    }
  });

  const columns: Column<any>[] = [
    { header: 'ID', accessorKey: 'id', className: 'w-16 font-mono text-muted-foreground' },
    { header: 'Criador', accessorKey: 'creatorUsername', className: 'font-medium text-primary' },
    { 
      header: 'Valor', 
      cell: (item) => <span className="font-bold font-mono">{(item.amount / 100).toLocaleString()} MZN</span>
    },
    { 
      header: 'Método / Conta', 
      cell: (item) => (
        <div className="flex flex-col">
          <span className="text-sm">{item.method}</span>
          <span className="text-xs text-muted-foreground font-mono">{item.destinationDetails?.iban ?? '—'}</span>
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
      cell: (item) => item.status === 'pendente' && (
        <div className="flex justify-end gap-2">
          <Button 
            size="sm" 
            variant="outline" 
            className="border-green-500/30 text-green-500 hover:bg-green-500/10 h-8 px-2"
            onClick={() => {
              if (confirm('Marcar como pago? Este processo é irreversível.')) {
                updateWithdrawal.mutate({ id: item.id, status: 'aprovado' });
              }
            }}
          >
            <CheckCircle2 className="h-4 w-4 mr-1" /> Marcar Pago
          </Button>
          <Button 
            size="sm" 
            variant="outline" 
            className="border-red-500/30 text-red-500 hover:bg-red-500/10 h-8 px-2"
            onClick={() => {
              const reason = prompt('Motivo da rejeição:');
              if (reason) {
                updateWithdrawal.mutate({ id: item.id, status: 'rejeitado' });
              }
            }}
          >
            <XCircle className="h-4 w-4 mr-1" /> Rejeitar
          </Button>
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
            <SelectItem value="aprovado">Aprovados/Pagos</SelectItem>
            <SelectItem value="rejeitado">Rejeitados</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable 
        columns={columns} 
        data={(withdrawals as any)?.data ?? withdrawals ?? []} 
        isLoading={isLoading}
      />
    </div>
  );
}
