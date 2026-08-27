import { useAuth, DadosBancarios } from '@/contexts/AuthContext';
import { useLocation } from 'wouter';
import { useEffect, useState } from 'react';
import { PlanDialog } from '@/components/monetization/PlanDialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Users, Eye, Activity, Plus, TrendingUp, Wallet, Building2, CheckCircle2, AlertCircle, ArrowDownToLine, CalendarDays, Lock, Loader2, Radio } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
import { cn } from '@/lib/utils';
import {
  useGetCreatorStats,
  useGetSubscriptionPlans,
  useGetCreatorEarnings,
  getGetCreatorStatsQueryKey,
  getGetSubscriptionPlansQueryKey,
  getGetCreatorEarningsQueryKey,
  type SubscriptionPlan,
  getFreshAuthToken,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

type Period = '7d' | '30d' | '1y';

function formatKz(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M Kz`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K Kz`;
  return `${value} Kz`;
}

const ANGOLAN_BANKS = [
  'BAI - Banco Angolano de Investimentos',
  'BFA - Banco de Fomento Angola',
  'BPC - Banco de Poupança e Crédito',
  'BIC - Banco BIC',
  'Millennium Atlântico',
  'SOL - Banco Sol',
  'Keve - Banco Keve',
  'BNI - Banco de Negócios Internacional',
  'Outro',
];

export default function Monetization() {
  const { user, ganhos, getMockUserData, saveDadosBancarios, requestWithdrawal } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const [period, setPeriod] = useState<Period>('30d');

  // Bank details
  const [editingBank, setEditingBank] = useState(false);
  const [bankForm, setBankForm] = useState<DadosBancarios>({ iban: '', nomeTitular: '', banco: '' });
  const [bankSaved, setBankSaved] = useState(false);
  const [bankError, setBankError] = useState('');

  // Plan dialogs
  const [editPlan, setEditPlan] = useState<SubscriptionPlan | null>(null);
  const [newPlanOpen, setNewPlanOpen] = useState(false);

  // Withdrawal
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawalError, setWithdrawalError] = useState('');
  const [withdrawalSuccess, setWithdrawalSuccess] = useState<number | null>(null);

  // Live stream state
  const [activeStreamId, setActiveStreamId] = useState<number | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);

  const today = new Date();
  const isWithdrawalDay = today.getDate() === 29;

  // ── API queries ───────────────────────────────────────────────────────────
  const { data: stats, isLoading: statsLoading } = useGetCreatorStats({
    query: { queryKey: getGetCreatorStatsQueryKey(), enabled: !!user && user.tipoConta === 'criador' },
  });

  const { data: plans, isLoading: plansLoading } = useGetSubscriptionPlans({
    query: { queryKey: getGetSubscriptionPlansQueryKey(), enabled: !!user && user.tipoConta === 'criador' },
  });

  const { data: earningsRaw, isLoading: earningsLoading } = useGetCreatorEarnings(
    { period },
    { query: { queryKey: getGetCreatorEarningsQueryKey({ period }), enabled: !!user && user.tipoConta === 'criador' } },
  );

  // Format chart data
  const chartData = (earningsRaw ?? []).map((p) => ({
    date: new Date(p.data).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' }),
    ganhos: p.valor,
  }));

  // ── Effects ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (user && user.tipoConta !== 'criador') setLocation('/home');
  }, [user, setLocation]);

  useEffect(() => {
    const data = getMockUserData();
    if (data?.dadosBancarios) setBankForm(data.dadosBancarios);
  }, [getMockUserData]);

  // Verificar live activa ao montar
  useEffect(() => {
    if (!user || user.tipoConta !== 'criador') return;
    (async () => {
      try {
        const token = await getFreshAuthToken();
        const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
        const res = await fetch(`${base}/api/live/active`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const streams: Array<{ id: number; criadorId: number }> = await res.json();
        const mine = streams.find((s) => s.criadorId === user.id);
        setActiveStreamId(mine?.id ?? null);
      } catch { /* ignorar */ }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (!user || user.tipoConta !== 'criador') return null;

  const dadosBancarios = getMockUserData()?.dadosBancarios;

  // ── Handlers ──────────────────────────────────────────────────────────────
  function handleSaveBank() {
    setBankError('');
    if (!bankForm.iban.trim() || !bankForm.nomeTitular.trim() || !bankForm.banco.trim()) {
      setBankError('Preenche todos os campos.');
      return;
    }
    saveDadosBancarios(bankForm);
    setBankSaved(true);
    setEditingBank(false);
    setTimeout(() => setBankSaved(false), 3000);
  }

  async function handleWithdrawal() {
    setWithdrawing(true);
    setWithdrawalError('');
    setWithdrawalSuccess(null);
    try {
      const amount = await requestWithdrawal();
      setWithdrawalSuccess(amount);
    } catch (e: any) {
      setWithdrawalError(e.message || 'Erro ao solicitar levantamento.');
    } finally {
      setWithdrawing(false);
    }
  }

  function handlePlanSaved() {
    queryClient.invalidateQueries({ queryKey: ['/api/creator/plans'] });
    queryClient.invalidateQueries({ queryKey: ['/api/creator/stats'] });
  }

  async function handleStartLive() {
    setLiveLoading(true);
    try {
      const token = await getFreshAuthToken();
      const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
      const res = await fetch(`${base}/api/live/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || 'Erro ao iniciar live');
      }
      const stream: { id: number } = await res.json();
      setActiveStreamId(stream.id);
      setLocation(`/live/${stream.id}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao iniciar live';
      alert(msg);
    } finally {
      setLiveLoading(false);
    }
  }

  async function handleEndLive() {
    if (!activeStreamId) return;
    setLiveLoading(true);
    try {
      const token = await getFreshAuthToken();
      const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
      const res = await fetch(`${base}/api/live/${activeStreamId}/end`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || 'Erro ao terminar live');
      }
      setActiveStreamId(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao terminar live';
      alert(msg);
    } finally {
      setLiveLoading(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="w-full max-w-6xl mx-auto p-4 sm:p-8 pb-24">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Painel do Criador</h1>
          <p className="text-muted-foreground mt-1 text-sm sm:text-base">Gere os teus ganhos, subscritores e conteúdo exclusivo.</p>
        </div>
        <div className="bg-primary/10 border border-primary/20 text-primary px-4 py-2 rounded-xl font-bold flex items-center gap-2">
          <TrendingUp className="w-5 h-5" /> Fica com 90% do teu ganho em Kz
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Ganhos este Mês</CardTitle>
            <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">Kz</span>
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {(stats?.ganhosMes ?? 0).toLocaleString('pt-PT')} Kz
                </div>
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <Activity className="w-3 h-3" /> Ganhos no mês atual
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Subscritores Ativos</CardTitle>
            <Users className="w-4 h-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            ) : (
              <>
                <div className="text-2xl font-bold">{stats?.totalSubscritores ?? 0}</div>
                <p className="text-xs text-green-500 mt-1 flex items-center gap-1">
                  <Activity className="w-3 h-3" /> +{stats?.novosSubscritores ?? 0} novos este mês
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Retenção</CardTitle>
            <Activity className="w-4 h-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            ) : (
              <>
                <div className="text-2xl font-bold">{stats?.taxaRetencao ?? 0}%</div>
                <p className="text-xs text-muted-foreground mt-1">Taxa de renovação</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Conteúdo Publicado</CardTitle>
            <Eye className="w-4 h-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            ) : (
              <>
                <div className="text-2xl font-bold">{stats?.visualizacoesTotais ?? 0}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Total ganho: {(stats?.ganhosTotal ?? 0).toLocaleString('pt-PT')} Kz
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Live Stream Panel */}
      <Card className="mb-8 bg-gradient-to-r from-red-950/40 to-zinc-900/60 border-red-500/30">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${activeStreamId ? 'bg-red-600' : 'bg-zinc-700'}`}>
              <Radio className={`w-5 h-5 text-white ${activeStreamId ? 'animate-pulse' : ''}`} />
            </div>
            <div>
              <CardTitle className="text-base">Transmissão ao Vivo</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {activeStreamId ? `Live activa — ID #${activeStreamId}` : 'Sem live activa no momento'}
              </p>
            </div>
          </div>
          {activeStreamId && (
            <span className="inline-flex items-center gap-1 bg-red-600 text-white text-xs font-bold px-3 py-1 rounded-full animate-pulse">
              <span className="w-1.5 h-1.5 bg-white rounded-full" />
              AO VIVO
            </span>
          )}
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {activeStreamId ? (
            <>
              <Button
                onClick={() => setLocation(`/live/${activeStreamId}`)}
                className="gap-2 bg-red-600 hover:bg-red-700 border-0 text-white"
              >
                <Radio className="w-4 h-4" />
                Ir para a Live
              </Button>
              <Button
                onClick={handleEndLive}
                disabled={liveLoading}
                variant="outline"
                className="gap-2 border-red-500/50 text-red-400 hover:bg-red-950/50"
              >
                {liveLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Terminar Live
              </Button>
            </>
          ) : (
            <Button
              onClick={handleStartLive}
              disabled={liveLoading}
              className="gap-2 bg-gradient-to-r from-red-600 to-pink-600 hover:from-red-700 hover:to-pink-700 border-0 text-white font-semibold"
            >
              {liveLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Radio className="w-4 h-4" />
              )}
              {liveLoading ? 'A iniciar...' : 'Iniciar Live'}
            </Button>
          )}
          <p className="w-full text-xs text-muted-foreground mt-1">
            O player de vídeo (RTMP) será activado numa próxima fase. Por agora, a live permite gorjetas e comunicação em tempo real com os teus fãs.
          </p>
        </CardContent>
      </Card>

      {/* Chart + Plans */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
        <Card className="lg:col-span-2 bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Ganhos ao longo do tempo (Kz)</CardTitle>
            <div className="flex gap-2">
              {(['7d', '30d', '1y'] as Period[]).map((p) => (
                <Button
                  key={p}
                  variant={period === p ? 'default' : 'outline'}
                  size="sm"
                  className={cn('h-8', period === p && 'bg-secondary text-foreground')}
                  onClick={() => setPeriod(p)}
                >
                  {p === '7d' ? '7D' : p === '30d' ? '30D' : 'Anual'}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              {earningsLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
              ) : chartData.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <TrendingUp className="w-10 h-10 mb-2 opacity-30" />
                  <p className="text-sm">Nenhuma transação neste período</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#262626" vertical={false} />
                    <XAxis dataKey="date" stroke="#a0a0a0" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#a0a0a0" fontSize={12} tickLine={false} axisLine={false} tickFormatter={formatKz} width={70} />
                    <RechartsTooltip
                      contentStyle={{ backgroundColor: '#121212', border: '1px solid #262626', borderRadius: '8px' }}
                      itemStyle={{ color: '#ff3e72', fontWeight: 'bold' }}
                      formatter={(v: number) => [`${Number(v).toLocaleString('pt-PT')} Kz`, 'Ganhos']}
                    />
                    <Line type="monotone" dataKey="ganhos" stroke="#ff3e72" strokeWidth={3} dot={{ r: 4, fill: '#121212', strokeWidth: 2 }} activeDot={{ r: 6, fill: '#ff3e72' }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Plans Management */}
        <Card className="bg-card border-border flex flex-col">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Os Meus Planos</CardTitle>
            <Button size="icon" variant="ghost" className="h-8 w-8 text-primary hover:bg-primary/10 rounded-full" onClick={() => setNewPlanOpen(true)}>
              <Plus className="w-5 h-5" />
            </Button>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col gap-4">
            {plansLoading ? (
              <div className="flex items-center justify-center flex-1 py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : plans && plans.length > 0 ? (
              <>
                {plans.map((plan) => (
                  <div key={plan.id} className={cn(
                    'border rounded-xl p-4 relative overflow-hidden',
                    plan.ativo ? 'border-primary bg-primary/5' : 'border-border bg-secondary/30',
                  )}>
                    {plan.ativo && (
                      <div className="absolute top-0 right-0 bg-primary text-white text-[10px] font-bold px-2 py-0.5 rounded-bl-lg">ATIVO</div>
                    )}
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="font-bold text-lg">{plan.nome}</h3>
                      <span className="text-xl font-bold text-primary">
                        {plan.preco.toLocaleString('pt-PT')} Kz
                        <span className="text-sm text-muted-foreground font-normal">/mês</span>
                      </span>
                    </div>
                    {plan.beneficios && (
                      <p className="text-sm text-muted-foreground mb-4">{plan.beneficios}</p>
                    )}
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-white font-semibold">{plan.totalSubscritores} subscritor{plan.totalSubscritores !== 1 ? 'es' : ''}</span>
                      <Button variant="outline" size="sm" className="h-8 bg-secondary/50" onClick={() => setEditPlan(plan)}>
                        Editar
                      </Button>
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <div className="text-center py-4 text-muted-foreground text-sm">
                <p>Ainda não tens planos de subscrição.</p>
              </div>
            )}

            <div
              className="border border-border border-dashed rounded-xl p-4 flex flex-col items-center justify-center text-center text-muted-foreground min-h-[100px] hover:bg-secondary/50 hover:text-foreground transition-colors cursor-pointer"
              onClick={() => setNewPlanOpen(true)}
            >
              <Plus className="w-6 h-6 mb-2" />
              <p className="text-sm font-medium">Criar novo nível de subscrição</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Plan Dialogs */}
      <PlanDialog
        open={!!editPlan}
        onClose={() => setEditPlan(null)}
        mode="edit"
        plan={editPlan}
        onSaved={handlePlanSaved}
      />
      <PlanDialog
        open={newPlanOpen}
        onClose={() => setNewPlanOpen(false)}
        mode="create"
        onSaved={handlePlanSaved}
      />

      {/* Levantamento + Dados Bancários */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="w-5 h-5 text-green-400" />
              Saldo para Levantamento
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold mb-1">Disponível para levantar</p>
              <p className="text-3xl font-extrabold text-green-400">
                {(ganhos ?? 0).toLocaleString('pt-PT')} <span className="text-xl font-bold">Kz</span>
              </p>
            </div>

            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-secondary/50 rounded-xl p-3">
              <CalendarDays className="w-4 h-4 shrink-0 text-yellow-500" />
              <p>Os levantamentos estão disponíveis <strong className="text-foreground">todos os dias 29</strong> de cada mês.</p>
            </div>

            {withdrawalError && (
              <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-xl p-3">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                {withdrawalError}
              </div>
            )}
            {withdrawalSuccess !== null && (
              <div className="flex items-center gap-2 text-sm text-green-400 bg-green-500/10 border border-green-500/20 rounded-xl p-3">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                Levantamento de <strong>{withdrawalSuccess.toLocaleString('pt-PT')} Kz</strong> solicitado com sucesso!
              </div>
            )}

            <Button
              className={cn(
                'w-full h-12 font-bold rounded-xl gap-2',
                isWithdrawalDay
                  ? 'bg-green-500 hover:bg-green-400 text-black shadow-[0_0_20px_rgba(34,197,94,0.3)]'
                  : 'bg-secondary text-muted-foreground cursor-not-allowed',
              )}
              disabled={!isWithdrawalDay || withdrawing || (ganhos ?? 0) < 1000 || !dadosBancarios}
              onClick={handleWithdrawal}
            >
              {withdrawing ? (
                'A processar...'
              ) : isWithdrawalDay ? (
                <><ArrowDownToLine className="w-4 h-4" /> Solicitar Levantamento</>
              ) : (
                <><Lock className="w-4 h-4" /> Disponível no dia 29</>
              )}
            </Button>

            {!dadosBancarios && (
              <p className="text-xs text-muted-foreground text-center">
                Tens de <button className="text-primary underline" onClick={() => setEditingBank(true)}>adicionar os teus dados bancários</button> antes de solicitar um levantamento.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-blue-400" />
              Dados Bancários
            </CardTitle>
            {dadosBancarios && !editingBank && (
              <Button variant="outline" size="sm" className="h-8" onClick={() => setEditingBank(true)}>
                Editar
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {bankSaved && (
              <div className="flex items-center gap-2 text-sm text-green-400 bg-green-500/10 border border-green-500/20 rounded-xl p-3 mb-4">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                Dados bancários guardados com sucesso!
              </div>
            )}

            {dadosBancarios && !editingBank ? (
              <div className="bg-secondary/60 border border-border rounded-xl p-4 space-y-3">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold mb-0.5">Titular</p>
                  <p className="text-sm font-bold">{dadosBancarios.nomeTitular}</p>
                </div>
                <div className="h-px bg-border" />
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold mb-0.5">Banco</p>
                  <p className="text-sm font-bold">{dadosBancarios.banco}</p>
                </div>
                <div className="h-px bg-border" />
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold mb-0.5">IBAN</p>
                  <p className="text-sm font-bold font-mono tracking-wider">{dadosBancarios.iban}</p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {!dadosBancarios && !editingBank && (
                  <div className="text-center py-6">
                    <Building2 className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-40" />
                    <p className="text-sm text-muted-foreground mb-4">Adiciona os teus dados bancários para receber os teus ganhos.</p>
                    <Button variant="outline" className="rounded-xl" onClick={() => setEditingBank(true)}>
                      <Plus className="w-4 h-4 mr-2" />
                      Adicionar dados bancários
                    </Button>
                  </div>
                )}

                {editingBank && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-muted-foreground font-medium mb-1.5 block">Nome do titular</label>
                      <Input
                        placeholder="Nome completo do titular da conta"
                        value={bankForm.nomeTitular}
                        onChange={(e) => setBankForm(f => ({ ...f, nomeTitular: e.target.value }))}
                        className="bg-secondary border-border"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground font-medium mb-1.5 block">Banco</label>
                      <select
                        value={bankForm.banco}
                        onChange={(e) => setBankForm(f => ({ ...f, banco: e.target.value }))}
                        className="w-full h-10 rounded-md bg-secondary border border-border px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        <option value="">Seleciona o banco</option>
                        {ANGOLAN_BANKS.map(b => (
                          <option key={b} value={b}>{b}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground font-medium mb-1.5 block">IBAN</label>
                      <Input
                        placeholder="AO06 0000 0000 0000 0000 0000 0"
                        value={bankForm.iban}
                        onChange={(e) => setBankForm(f => ({ ...f, iban: e.target.value }))}
                        className="bg-secondary border-border font-mono tracking-wider"
                      />
                    </div>

                    {bankError && <p className="text-xs text-destructive">{bankError}</p>}

                    <div className="flex gap-2 pt-1">
                      {dadosBancarios && (
                        <Button variant="outline" className="flex-1 rounded-xl" onClick={() => { setEditingBank(false); setBankError(''); }}>
                          Cancelar
                        </Button>
                      )}
                      <Button className="flex-1 rounded-xl font-bold" onClick={handleSaveBank}>
                        Guardar dados bancários
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
