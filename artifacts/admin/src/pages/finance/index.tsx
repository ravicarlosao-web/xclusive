import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DataTable, Column } from '@/components/tables/DataTable';
import { StatusBadge } from '@/components/badges/StatusBadge';
import { Download, TrendingUp, Wallet, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { format } from 'date-fns';

export default function Finance() {
  const { data: kpis, isLoading: isLoadingKpis } = useQuery({
    queryKey: ['finance', 'kpis'],
    queryFn: adminApi.getFinanceKpis
  });

  const { data: transactions, isLoading: isLoadingTx } = useQuery({
    queryKey: ['finance', 'transactions'],
    queryFn: () => adminApi.getTransactions()
  });

  const handleExport = async () => {
    try {
      const blob = await adminApi.exportTransactions();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `transactions-${format(new Date(), 'yyyy-MM-dd')}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      console.error(e);
    }
  };

  const columns: Column<any>[] = [
    { header: 'ID', accessorKey: 'id', className: 'font-mono text-xs text-muted-foreground' },
    { 
      header: 'Tipo', 
      cell: (item) => (
        <div className="flex items-center gap-2">
          {item.tipo === 'subscricao' ? (
            <ArrowDownRight className="h-4 w-4 text-green-500" />
          ) : (
            <ArrowUpRight className="h-4 w-4 text-orange-500" />
          )}
          <span className="capitalize">{item.tipo}</span>
        </div>
      )
    },
    { 
      header: 'Valor', 
      cell: (item) => (
        <span className={`font-bold font-mono ${item.tipo === 'subscricao' ? 'text-green-500' : ''}`}>
          {item.tipo === 'subscricao' ? '+' : ''}{item.valor?.toLocaleString()} MZN
        </span>
      )
    },
    { header: 'Pagador', accessorKey: 'pagadorUsername', className: 'text-primary' },
    { 
      header: 'Data', 
      cell: (item) => <span className="text-muted-foreground">{format(new Date(item.criadoEm), 'dd MMM yyyy, HH:mm')}</span>
    },
    { 
      header: 'Estado', 
      cell: (item) => <StatusBadge status={item.status} />
    }
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Financeiro</h1>
          <p className="text-muted-foreground">Visão global das transações e receitas da plataforma.</p>
        </div>
        <Button onClick={handleExport} variant="outline" className="bg-card">
          <Download className="mr-2 h-4 w-4" /> Exportar CSV
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Volume Processado</CardTitle>
            <TrendingUp className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">
              {isLoadingKpis ? '...' : `${kpis?.receitaTotal?.toLocaleString()} MZN`}
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-primary/50 bg-primary/5">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-primary">Receita da Plataforma (Taxas)</CardTitle>
            <Wallet className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-primary">
              {isLoadingKpis ? '...' : `${kpis?.comissaoRetida?.toLocaleString()} MZN`}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Payouts Concluídos</CardTitle>
            <ArrowUpRight className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">
              {isLoadingKpis ? '...' : `${kpis?.pagoCriadores?.toLocaleString()} MZN`}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Payouts Pendentes</CardTitle>
            <ArrowUpRight className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-orange-500">
              {isLoadingKpis ? '...' : `${kpis?.receitaMes?.toLocaleString()} MZN`}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="pt-4">
        <h2 className="text-xl font-bold mb-4">Registo de Transações</h2>
        <DataTable 
          columns={columns} 
          data={(transactions as any)?.data ?? transactions ?? []} 
          isLoading={isLoadingTx}
        />
      </div>
    </div>
  );
}
