import { useAuth } from '@/contexts/AuthContext';
import { useLocation } from 'wouter';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Users, Euro, Eye, Activity, Plus } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';

const mockChartData = [
  { date: '1 Mar', ganhos: 45 },
  { date: '5 Mar', ganhos: 120 },
  { date: '10 Mar', ganhos: 85 },
  { date: '15 Mar', ganhos: 250 },
  { date: '20 Mar', ganhos: 190 },
  { date: '25 Mar', ganhos: 310 },
  { date: '30 Mar', ganhos: 450 },
];

export default function Monetization() {
  const { user } = useAuth();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (user && user.tipoConta !== 'criador') {
      setLocation('/home');
    }
  }, [user, setLocation]);

  if (!user || user.tipoConta !== 'criador') return null;

  return (
    <div className="w-full max-w-6xl mx-auto p-4 sm:p-8 pb-24">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Painel do Criador</h1>
          <p className="text-muted-foreground mt-1 text-sm sm:text-base">Gere os teus ganhos, subscritores e conteúdo exclusivo.</p>
        </div>
        <div className="bg-primary/10 border border-primary/20 text-primary px-4 py-2 rounded-xl font-bold flex items-center gap-2">
          <Euro className="w-5 h-5" /> Fica com 90% do teu ganho
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Ganhos este Mês</CardTitle>
            <Euro className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">1,450.00€</div>
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
            <div className="text-2xl font-bold">3,892</div>
            <p className="text-xs text-muted-foreground mt-1">Ganhos: 245.50€</p>
          </CardContent>
        </Card>
      </div>

      {/* Chart Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
        <Card className="lg:col-span-2 bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Ganhos ao longo do tempo</CardTitle>
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
                  <YAxis stroke="#a0a0a0" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}€`} />
                  <RechartsTooltip 
                    contentStyle={{ backgroundColor: '#121212', border: '1px solid #262626', borderRadius: '8px' }}
                    itemStyle={{ color: '#ff3e72', fontWeight: 'bold' }}
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
            <Button size="icon" variant="ghost" className="h-8 w-8 text-primary hover:bg-primary/10 rounded-full">
              <Plus className="w-5 h-5" />
            </Button>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col gap-4">
            <div className="border border-primary bg-primary/5 rounded-xl p-4 relative overflow-hidden">
              <div className="absolute top-0 right-0 bg-primary text-white text-[10px] font-bold px-2 py-0.5 rounded-bl-lg">ATIVO</div>
              <div className="flex justify-between items-start mb-2">
                <h3 className="font-bold text-lg">VIP Club</h3>
                <span className="text-xl font-bold text-primary">4.99€<span className="text-sm text-muted-foreground font-normal">/mês</span></span>
              </div>
              <p className="text-sm text-muted-foreground mb-4">Acesso a todo o conteúdo exclusivo, chat direto e lives privadas.</p>
              <div className="flex items-center justify-between text-sm">
                <span className="text-white font-semibold">245 subscritores</span>
                <Button variant="outline" size="sm" className="h-8 bg-secondary/50">Editar</Button>
              </div>
            </div>

            <div className="border border-border border-dashed rounded-xl p-4 flex flex-col items-center justify-center text-center text-muted-foreground h-full min-h-[120px] hover:bg-secondary/50 hover:text-foreground transition-colors cursor-pointer">
              <Plus className="w-6 h-6 mb-2" />
              <p className="text-sm font-medium">Criar novo nível de subscrição</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}