import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { adminApi } from '@/lib/api';
import { DataTable, Column } from '@/components/tables/DataTable';
import { StatusBadge } from '@/components/badges/StatusBadge';
import { Button } from '@/components/ui/button';
import { ShieldCheck } from 'lucide-react';

export default function Creators() {
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState('');

  const { data: creators, isLoading } = useQuery({
    queryKey: ['creators'],
    queryFn: () => adminApi.getCreators()
  });

  const creatorList: any[] = creators?.data ?? creators ?? [];
  const filteredCreators = creatorList.filter((c: any) => 
    c.username?.toLowerCase().includes(searchTerm.toLowerCase()) || 
    c.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const columns: Column<any>[] = [
    { header: 'ID', accessorKey: 'id', className: 'w-16 font-mono text-muted-foreground' },
    { header: 'Username', accessorKey: 'username', className: 'font-medium text-primary' },
    { header: 'País', accessorKey: 'pais' },
    { 
      header: 'Subscritores', 
      cell: (item) => <span className="font-mono">{item.subscribers}</span>
    },
    { 
      header: 'Saldo', 
      cell: (item) => <span className="font-mono font-medium">{item.balance?.toLocaleString()} MZN</span>
    },
    { 
      header: 'Estado', 
      cell: (item) => <StatusBadge status={item.estado} />
    }
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start sm:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Criadores</h1>
          <p className="text-muted-foreground">Gestão de contas de criadores de conteúdo.</p>
        </div>
        <Button onClick={() => setLocation('/creators/kyc')} className="bg-primary text-primary-foreground">
          <ShieldCheck className="mr-2 h-4 w-4" />
          Fila de KYC
        </Button>
      </div>

      <DataTable 
        columns={columns} 
        data={filteredCreators} 
        isLoading={isLoading}
        searchPlaceholder="Pesquisar criadores..."
        onSearch={setSearchTerm}
        onRowClick={(item) => setLocation(`/users/${item.id}`)}
      />
    </div>
  );
}
