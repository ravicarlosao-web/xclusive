import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { DataTable, Column } from '@/components/tables/DataTable';
import { StatusBadge } from '@/components/badges/StatusBadge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { CheckCircle, XCircle, ExternalLink } from 'lucide-react';

export default function Reports() {
  const [statusFilter, setStatusFilter] = useState('pendente');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: reports, isLoading } = useQuery({
    queryKey: ['reports', statusFilter],
    queryFn: () => adminApi.getReports(statusFilter !== 'all' ? { status: statusFilter } : undefined)
  });

  const updateReport = useMutation({
    mutationFn: ({ id, status }: { id: number, status: string }) => adminApi.updateReport(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      toast({ title: 'Denúncia processada' });
    }
  });

  const columns: Column<any>[] = [
    { header: 'ID', accessorKey: 'id', className: 'w-16 font-mono text-muted-foreground' },
    { 
      header: 'Alvo', 
      cell: (item) => (
        <div className="flex items-center gap-2">
          <span className="uppercase text-[10px] font-bold bg-muted px-2 py-1 rounded text-muted-foreground tracking-widest">{item.targetType}</span>
          <span className="font-mono text-sm">#{item.targetId}</span>
          <Button variant="ghost" size="icon" className="h-6 w-6"><ExternalLink className="h-3 w-3" /></Button>
        </div>
      )
    },
    { 
      header: 'Reportado por', 
      cell: (item) => <span className="font-mono text-sm text-muted-foreground">User #{item.reporterId}</span>
    },
    { header: 'Motivo', accessorKey: 'reason', className: 'max-w-xs truncate' },
    { 
      header: 'Data', 
      cell: (item) => <span className="text-muted-foreground text-sm">{format(new Date(item.criadoEm), 'dd MMM, HH:mm')}</span>
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
            onClick={() => updateReport.mutate({ id: item.id, status: 'resolved' })}
          >
            <CheckCircle className="h-4 w-4 mr-1" /> Ação Tomada
          </Button>
          <Button 
            size="sm" 
            variant="outline" 
            className="border-gray-500/30 text-gray-400 hover:bg-gray-500/10 h-8 px-2"
            onClick={() => updateReport.mutate({ id: item.id, status: 'dismissed' })}
          >
            <XCircle className="h-4 w-4 mr-1" /> Ignorar
          </Button>
        </div>
      )
    }
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Denúncias</h1>
          <p className="text-muted-foreground">Gestão de reports de conteúdo e utilizadores.</p>
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px] bg-card">
            <SelectValue placeholder="Filtrar por estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="pendente">Pendentes</SelectItem>
            <SelectItem value="resolved">Resolvidas</SelectItem>
            <SelectItem value="dismissed">Ignoradas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable 
        columns={columns} 
        data={(reports as any)?.data ?? reports ?? []} 
        isLoading={isLoading}
      />
    </div>
  );
}
