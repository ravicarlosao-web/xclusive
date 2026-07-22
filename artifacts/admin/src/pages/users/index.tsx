import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { adminApi } from '@/lib/api';
import { DataTable, Column } from '@/components/tables/DataTable';
import { StatusBadge } from '@/components/badges/StatusBadge';
import { format } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function Users() {
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');

  const { data: users, isLoading } = useQuery({
    queryKey: ['users', roleFilter],
    queryFn: () => adminApi.getUsers(roleFilter !== 'all' ? { role: roleFilter } : undefined)
  });

  const userList: any[] = users?.data ?? users ?? [];
  const filteredUsers = userList.filter((u: any) => 
    u.username?.toLowerCase().includes(searchTerm.toLowerCase()) || 
    u.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const columns: Column<any>[] = [
    { header: 'ID', accessorKey: 'id', className: 'w-16 font-mono text-muted-foreground' },
    { header: 'Username', accessorKey: 'username', className: 'font-medium' },
    { header: 'Email', accessorKey: 'email', className: 'text-muted-foreground' },
    { 
      header: 'Role', 
      accessorKey: 'role',
      cell: (item) => (
        <span className={item.role === 'creator' ? 'text-primary font-bold' : 'text-foreground'}>
          {item.role === 'creator' ? 'Criador' : 'User'}
        </span>
      )
    },
    { header: 'País', accessorKey: 'pais' },
    { 
      header: 'Estado', 
      cell: (item) => <StatusBadge status={item.estado} />
    },
    { 
      header: 'Registado em', 
      cell: (item) => <span className="text-muted-foreground">{format(new Date(item.criadoEm ?? item.joinedAt), 'dd MMM yyyy')}</span>
    }
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Utilizadores</h1>
          <p className="text-muted-foreground">Gerir contas de utilizadores e criadores.</p>
        </div>
        
        <div className="flex items-center gap-2">
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-[150px] bg-card border-border">
              <SelectValue placeholder="Filtrar por tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="user">Apenas Users</SelectItem>
              <SelectItem value="creator">Apenas Criadores</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable 
        columns={columns} 
        data={filteredUsers} 
        isLoading={isLoading}
        searchPlaceholder="Pesquisar por username ou email..."
        onSearch={setSearchTerm}
        onRowClick={(item) => setLocation(`/users/${item.id}`)}
      />
    </div>
  );
}
