import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { DataTable, Column } from '@/components/tables/DataTable';
import { format } from 'date-fns';

export default function AuditLog() {
  const [searchTerm, setSearchTerm] = useState('');

  const { data: logs, isLoading } = useQuery({
    queryKey: ['audit-log'],
    queryFn: () => adminApi.getAuditLog()
  });

  const logList: any[] = logs?.data ?? logs ?? [];
  const filteredLogs = logList.filter((l: any) => 
    l.admin?.toLowerCase().includes(searchTerm.toLowerCase()) || 
    l.action?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const columns: Column<any>[] = [
    { header: 'ID', accessorKey: 'id', className: 'w-16 font-mono text-muted-foreground' },
    { 
      header: 'Data/Hora', 
      cell: (item) => <span className="text-muted-foreground text-sm whitespace-nowrap">{format(new Date(item.timestamp), 'dd MMM yyyy, HH:mm:ss')}</span>
    },
    { header: 'Administrador', accessorKey: 'admin', className: 'font-mono text-sm' },
    { 
      header: 'Ação', 
      cell: (item) => <span className="uppercase text-xs tracking-wider bg-muted px-2 py-1 rounded text-primary">{item.action}</span>
    },
    { header: 'Detalhes', accessorKey: 'details', className: 'text-sm text-muted-foreground' }
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Audit Log</h1>
        <p className="text-muted-foreground">Registo imutável de todas as ações administrativas.</p>
      </div>

      <DataTable 
        columns={columns} 
        data={filteredLogs} 
        isLoading={isLoading}
        searchPlaceholder="Pesquisar por admin ou ação..."
        onSearch={setSearchTerm}
      />
    </div>
  );
}
