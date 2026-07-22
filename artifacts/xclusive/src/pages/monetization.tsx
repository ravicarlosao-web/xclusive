import { useAuth, DadosBancarios } from '@/contexts/AuthContext';
import { useLocation } from 'wouter';
import { useEffect, useState } from 'react';
import { PlanDialog } from '@/components/monetization/PlanDialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Users, Eye, Activity, Plus, TrendingUp, Wallet, Building2, CheckCircle2, AlertCircle, ArrowDownToLine, CalendarDays, Lock } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
import { cn } from '@/lib/utils';

// Valores em Kwanza angolano (AOA)
const mockChartData = [
  { date: '1 Mar', ganhos: 40500 },
  { date: '5 Mar', ganhos: 108000 },
  { date: '10 Mar', ganhos: 76500 },
  { date: '15 Mar', ganhos: 225000 },
  { date: '20 Mar', ganhos: 171000 },
  { date: '25 Mar', ganhos: 279000 },
  { date: '30 Mar', ganhos: 405000 },
];

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

  // Bank details form
  const [editingBank, setEditingBank] = useState(false);
  const [bankForm, setBankForm] = useState<DadosBancarios>({ iban: '', nomeTitular: '', banco: '' });
  const [bankSaved, setBankSaved] = useState(false);
  const [bankError, setBankError] = useState('');

  // Plan dialogs
  const [editPlanOpen, setEditPlanOpen] = useState(false);
  const [newPlanOpen, setNewPlanOpen] = useState(false);

  // Withdrawal
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawalError, setWithdrawalError] = useState('');
  const [withdrawalSuccess, setWithdrawalSuccess] = useState<number | null>(null);

  const today = new Date();
  const isWithdrawalDay = today.getDate() === 29;

  useEffect(() => {
    if (user && user.tipoConta !== 'criador') {
      setLocation('/home');
    }
  }, [user, setLocation]);

  // Load existing bank details
  useEffect(() => {
    const data = getMockUserData();
    if (data?.dadosBancarios) {
      setBankForm(data.dadosBancarios);
    }
  }, [getMockUserData]);

  if (!user || user.tipoConta !== 'criador') return null;

  const dadosBancarios = getMockUserData()?.dadosBancarios;

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
            <div className="text-2xl font-bold">1.305.000 Kz</div>
            <p className="text-xs text-green-500 mt-1 flex items-center gap-1">
              <Activity className="w-3 h-3" /> +15.3% do último mês
            </p>
          </CardContent>
        </Card>
        
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Subscritores Ativos</CardTitle>
            <Users className="w-4 h-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">245</div>
            <p className="text-xs text-green-500 mt-1 flex items-center gap-1">
              <Activity className="w-3 h-3" /> +12 novos esta semana
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Retenção</CardTitle>
            <Activity className="w-4 h-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">84%</div>
            <p className="text-xs text-muted-foreground mt-1">Taxa de renovação</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Visualizações PPV</CardTitle>
            <Eye className="w-4 h-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">3.892</div>
            <p className="text-xs text-muted-foreground mt-1">Ganhos: 220.950 Kz</p>
          </CardContent>
        </Card>
      </div>

      {/* Chart + Plans */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
        <Card className="lg:col-span-2 bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Ganhos ao longo do tempo (Kz)</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-8">7D</Button>
              <Button variant="default" size="sm" className="h-8 bg-secondary text-foreground">30D</Button>
              <Button variant="outline" size="sm" className="h-8">Anual</Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={mockChartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
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
            <div className="border border-primary bg-primary/5 rounded-xl p-4 relative overflow-hidden">
              <div className="absolute top-0 right-0 bg-primary text-white text-[10px] font-bold px-2 py-0.5 rounded-bl-lg">ATIVO</div>
              <div className="flex justify-between items-start mb-2">
                <h3 className="font-bold text-lg">VIP Club</h3>
                <span className="text-xl font-bold text-primary">4.990 Kz<span className="text-sm text-muted-foreground font-normal">/mês</span></span>
              </div>
              <p className="text-sm text-muted-foreground mb-4">Acesso a todo o conteúdo exclusivo, chat direto e lives privadas.</p>
              <div className="flex items-center justify-between text-sm">
                <span className="text-white font-semibold">245 subscritores</span>
                <Button variant="outline" size="sm" className="h-8 bg-secondary/50" onClick={() => setEditPlanOpen(true)}>Editar</Button>
              </div>
            </div>
            <div
              className="border border-border border-dashed rounded-xl p-4 flex flex-col items-center justify-center text-center text-muted-foreground h-full min-h-[120px] hover:bg-secondary/50 hover:text-foreground transition-colors cursor-pointer"
              onClick={() => setNewPlanOpen(true)}
            >
              <Plus className="w-6 h-6 mb-2" />
              <p className="text-sm font-medium">Criar novo nível de subscrição</p>
            </div>
          </CardContent>
        </Card>

        {/* Plan dialogs */}
        <PlanDialog
          open={editPlanOpen}
          onClose={() => setEditPlanOpen(false)}
          mode="edit"
          initial={{ nome: 'VIP Club', preco: '4990', descricao: 'Acesso a todo o conteúdo exclusivo, chat direto e lives privadas.' }}
        />
        <PlanDialog
          open={newPlanOpen}
          onClose={() => setNewPlanOpen(false)}
          mode="create"
        />
      </div>

      {/* ── Levantamento + Dados Bancários ─────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

        {/* Saldo para levantamento */}
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

            {/* Withdrawal error / success */}
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
                "w-full h-12 font-bold rounded-xl gap-2",
                isWithdrawalDay
                  ? "bg-green-500 hover:bg-green-400 text-black shadow-[0_0_20px_rgba(34,197,94,0.3)]"
                  : "bg-secondary text-muted-foreground cursor-not-allowed"
              )}
              disabled={!isWithdrawalDay || withdrawing || (ganhos ?? 0) < 1000 || !dadosBancarios}
              onClick={handleWithdrawal}
            >
              {withdrawing ? (
                'A processar...'
              ) : isWithdrawalDay ? (
                <>
                  <ArrowDownToLine className="w-4 h-4" />
                  Solicitar Levantamento
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  Disponível no dia 29
                </>
              )}
            </Button>

            {!dadosBancarios && (
              <p className="text-xs text-muted-foreground text-center">
                Tens de <button className="text-primary underline" onClick={() => setEditingBank(true)}>adicionar os teus dados bancários</button> antes de solicitar um levantamento.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Dados bancários */}
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
              /* View mode */
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
              /* Edit / Add mode */
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

                {(editingBank || (!dadosBancarios && editingBank)) && (
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

                    {bankError && (
                      <p className="text-xs text-destructive">{bankError}</p>
                    )}

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
