import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, Star, DollarSign, Activity, AlertCircle, ShieldAlert, CreditCard } from 'lucide-react';
import { LineChart } from '@/components/charts/LineChart';
import { BarChart } from '@/components/charts/BarChart';
import { cn } from '@/lib/utils';

export default function Dashboard() {
  const { data: kpis, isLoading: isLoadingKpis } = useQuery({
    queryKey: ['dashboard', 'kpis'],
    queryFn: adminApi.getDashboardKpis
  });

  const { data: charts, isLoading: isLoadingCharts } = useQuery({
    queryKey: ['dashboard', 'charts'],
    queryFn: adminApi.getDashboardCharts
  });

  const { data: feed, isLoading: isLoadingFeed } = useQuery({
    queryKey: ['dashboard', 'feed'],
    queryFn: adminApi.getActivityFeed,
    refetchInterval: 15000
  });

  const kpiCards = [
    { title: 'Total Users', value: kpis?.totalUsers, icon: Users, color: 'text-blue-500', bg: 'bg-blue-500/10' },
    { title: 'Active Creators', value: kpis?.totalCreators, icon: Star, color: 'text-yellow-500', bg: 'bg-yellow-500/10' },
    { title: 'Monthly Revenue', value: `${kpis?.monthlyRevenue?.toLocaleString()} MZN`, icon: DollarSign, color: 'text-green-500', bg: 'bg-green-500/10' },
    { title: 'Active Subs', value: kpis?.activeSubscriptions, icon: Activity, color: 'text-purple-500', bg: 'bg-purple-500/10' },
    { title: 'KYC Pending', value: kpis?.kycPending, icon: ShieldAlert, color: 'text-orange-500', bg: 'bg-orange-500/10', alert: (kpis?.kycPending || 0) > 10 },
    { title: 'Reports', value: kpis?.reportsPending, icon: AlertCircle, color: 'text-red-500', bg: 'bg-red-500/10', alert: (kpis?.reportsPending || 0) > 20 },
    { title: 'Withdrawals', value: kpis?.withdrawalsPending, icon: CreditCard, color: 'text-cyan-500', bg: 'bg-cyan-500/10' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Visão geral do sistema e métricas principais.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {kpiCards.map((kpi, i) => (
          <Card key={i} className={cn("border-border", kpi.alert && "border-destructive/50")}>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium text-muted-foreground">{kpi.title}</CardTitle>
              <div className={cn("p-2 rounded-md", kpi.bg)}>
                <kpi.icon className={cn("h-4 w-4", kpi.color)} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {isLoadingKpis ? <div className="h-8 w-24 bg-muted animate-pulse rounded" /> : kpi.value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4 border-border">
          <CardHeader>
            <CardTitle>Crescimento (Users vs Creators)</CardTitle>
          </CardHeader>
          <CardContent className="pl-0">
            {isLoadingCharts ? (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">A carregar gráfico...</div>
            ) : (
              <BarChart 
                data={charts?.userGrowthData || []} 
                xAxisKey="name"
                bars={[
                  { dataKey: 'users', color: 'hsl(var(--primary))', name: 'Users' },
                  { dataKey: 'creators', color: 'hsl(var(--primary)/0.3)', name: 'Creators' }
                ]}
              />
            )}
          </CardContent>
        </Card>

        <Card className="col-span-3 border-border">
          <CardHeader>
            <CardTitle>Receita Mensal (MZN)</CardTitle>
          </CardHeader>
          <CardContent className="pl-0">
            {isLoadingCharts ? (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">A carregar gráfico...</div>
            ) : (
              <LineChart 
                data={charts?.revenueData || []} 
                xAxisKey="name"
                lines={[
                  { dataKey: 'value', color: 'hsl(var(--chart-4))', name: 'Revenue' }
                ]}
              />
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Live Activity Feed
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {isLoadingFeed ? (
              Array.from({length: 5}).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="h-2 w-2 rounded-full bg-muted animate-pulse" />
                  <div className="space-y-2 flex-1">
                    <div className="h-4 w-full bg-muted animate-pulse rounded" />
                  </div>
                </div>
              ))
            ) : (
              feed?.map((item: any) => (
                <div key={item.id} className="flex items-start gap-4 text-sm group">
                  <div className="mt-1.5 h-2 w-2 rounded-full bg-primary ring-4 ring-primary/20 group-hover:ring-primary/40 transition-all" />
                  <div className="flex-1 space-y-1">
                    <p className="font-medium leading-none">{item.message}</p>
                    <p className="text-xs text-muted-foreground font-mono">{item.timestamp}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
