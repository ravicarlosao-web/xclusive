import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { adminApi } from '@/lib/api';
import { DataTable, Column } from '@/components/tables/DataTable';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format } from 'date-fns';

export const ESTADO_CASO: Record<string, { texto: string; classe: string }> = {
  aberto: { texto: 'Aberto', classe: 'bg-yellow-500/10 text-yellow-300 border-yellow-500/30' },
  confirmado: { texto: 'Confirmado', classe: 'bg-red-900/30 text-red-300 border-red-700/50' },
  arquivado: { texto: 'Arquivado', classe: 'bg-slate-500/10 text-slate-300 border-slate-500/30' },
};

export function EstadoCaso({ estado }: { estado: string }) {
  const e = ESTADO_CASO[estado] ?? { texto: estado, classe: 'bg-gray-500/10 text-gray-300 border-gray-500/30' };
  return <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${e.classe}`} data-testid="estado-caso">{e.texto}</span>;
}

/** Vista própria dos casos do procedimento interno: só admin. */
export default function Menores() {
  const [estado, setEstado] = useState('aberto');
  const { data, isLoading } = useQuery({
    queryKey: ['menores', estado],
    queryFn: () => adminApi.getMenores({ limit: '100', ...(estado !== 'todos' ? { estado } : {}) }),
  });

  const columns: Column<any>[] = [
    { header: 'Caso', cell: (c) => <Link href={`/menores/${c.id}`} className="font-mono text-primary underline" data-testid={`caso-${c.id}`}>#{c.id}</Link> },
    { header: 'Aberto em', cell: (c) => <span className="text-sm">{format(new Date(c.abertoEm), 'dd/MM/yyyy HH:mm')}</span> },
    { header: 'Conta', cell: (c) => <Link href={`/users/${c.userId}`} className="text-primary underline">@{c.username}</Link> },
    { header: 'Estado', cell: (c) => <EstadoCaso estado={c.estado} /> },
    { header: 'Denúncia', cell: (c) => <span className="text-sm text-muted-foreground">{c.reportId ? `#${c.reportId}` : '—'}</span> },
    { header: 'Decisão', cell: (c) => <span className="text-sm text-muted-foreground">{c.decisaoEm ? format(new Date(c.decisaoEm), 'dd/MM/yyyy HH:mm') : '—'}</span> },
    { header: 'Autoridade', cell: (c) => <span className="text-sm">{c.autoridadeComunicada ? 'Comunicada' : 'Por comunicar'}</span> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Casos</h1>
          <p className="text-muted-foreground">Registo interno do procedimento. Acesso restrito e registado.</p>
        </div>
        <Select value={estado} onValueChange={setEstado}>
          <SelectTrigger className="w-[180px] bg-card" aria-label="Filtrar por estado">
            <SelectValue placeholder="Filtrar por estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="aberto">Abertos</SelectItem>
            <SelectItem value="confirmado">Confirmados</SelectItem>
            <SelectItem value="arquivado">Arquivados</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <DataTable columns={columns} data={(data as any)?.data ?? []} isLoading={isLoading} />
    </div>
  );
}
