import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Save } from 'lucide-react';

export default function Settings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [formData, setFormData] = useState<any>(null);

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: adminApi.getSettings
  });

  useEffect(() => {
    if (settings && !formData) {
      setFormData({
        commissionRate: (settings as any).commission_rate?.value ?? 20,
        minWithdrawalAmount: (settings as any).min_withdrawal_amount?.value ?? 5000,
        maintenanceMode: (settings as any).maintenance_mode?.enabled ?? false,
        allowedCountries: ((settings as any).allowed_countries?.list ?? []).join(', '),
      });
    }
  }, [settings, formData]);

  const updateSettings = useMutation({
    mutationFn: (data: any) => adminApi.updateSettings({
      commission_rate: { value: data.commissionRate },
      min_withdrawal_amount: { value: data.minWithdrawalAmount },
      maintenance_mode: { enabled: data.maintenanceMode },
      allowed_countries: { list: data.allowedCountries.split(',').map((s: string) => s.trim()) },
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast({ title: 'Definições guardadas com sucesso' });
    }
  });

  if (isLoading || !formData) return <div>A carregar definições...</div>;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Definições da Plataforma</h1>
        <p className="text-muted-foreground">Configurações globais que afetam todos os utilizadores.</p>
      </div>

      <div className="grid gap-6">
        <Card className="border-border">
          <CardHeader>
            <CardTitle>Comissões e Limites</CardTitle>
            <CardDescription>Configuração de taxas aplicadas aos ganhos dos criadores.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Taxa da Plataforma (%)</Label>
                <Input 
                  type="number" 
                  value={formData.commissionRate} 
                  onChange={e => setFormData({...formData, commissionRate: Number(e.target.value)})}
                  className="bg-card font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label>Levantamento Mínimo (Moeda Base)</Label>
                <Input 
                  type="number" 
                  value={formData.minWithdrawalAmount} 
                  onChange={e => setFormData({...formData, minWithdrawalAmount: Number(e.target.value)})}
                  className="bg-card font-mono"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader>
            <CardTitle>Geografia e Acessos</CardTitle>
            <CardDescription>Controlo de regiões suportadas.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Países Permitidos (Códigos ISO separados por vírgula)</Label>
              <Input 
                value={formData.allowedCountries} 
                onChange={e => setFormData({...formData, allowedCountries: e.target.value})}
                className="bg-card font-mono uppercase"
              />
              <p className="text-xs text-muted-foreground">Exemplo: MZ, AO, PT, BR</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border border-destructive/20">
          <CardHeader>
            <CardTitle className="text-destructive">Modo de Manutenção</CardTitle>
            <CardDescription>Impede o acesso público à plataforma. Os administradores mantêm o acesso.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between border border-border p-4 rounded-lg bg-card/50">
              <div className="space-y-0.5">
                <Label className="text-base">Ativar Modo Manutenção</Label>
                <p className="text-sm text-muted-foreground">O site mostrará uma página de "Em breve / Manutenção".</p>
              </div>
              <Switch 
                checked={formData.maintenanceMode} 
                onCheckedChange={c => setFormData({...formData, maintenanceMode: c})}
                className="data-[state=checked]:bg-destructive"
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button 
            size="lg" 
            onClick={() => updateSettings.mutate(formData)}
            disabled={updateSettings.isPending}
            className="w-full sm:w-auto"
          >
            <Save className="mr-2 h-5 w-5" /> Guardar Alterações
          </Button>
        </div>
      </div>
    </div>
  );
}
