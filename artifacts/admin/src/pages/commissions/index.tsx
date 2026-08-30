import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Save, Pencil, X, Check, Search, RotateCcw, Percent } from 'lucide-react';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface CreatorCommission {
  id: number;
  username: string;
  nomeExibicao: string;
  verificado: boolean;
  comissaoPersonalizada: number | null;
  taxaEfectiva: number;
  fonte: 'personalizada' | 'global';
  taxaGlobal: number;
}

interface CommissionOverview {
  taxaGlobal: number;
  criadores: CreatorCommission[];
}

// ── Componente de linha editável ──────────────────────────────────────────────

function CreatorCommissionRow({
  creator,
  onSave,
  isSaving,
}: {
  creator: CreatorCommission;
  onSave: (id: number, value: number | null) => void;
  isSaving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState('');

  const startEdit = () => {
    setInputValue(creator.comissaoPersonalizada !== null ? String(creator.comissaoPersonalizada) : '');
    setError('');
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setError('');
  };

  const validate = (v: string): number | null | false => {
    if (v.trim() === '') return false; // empty = invalid
    const n = parseFloat(v);
    if (isNaN(n) || n < 0 || n > 100) return false;
    return n;
  };

  const handleSave = () => {
    const parsed = validate(inputValue);
    if (parsed === false) {
      setError('Valor deve ser entre 0 e 100.');
      return;
    }
    setEditing(false);
    onSave(creator.id, parsed);
  };

  const handleReset = () => {
    setEditing(false);
    onSave(creator.id, null);
  };

  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
      {/* Criador */}
      <td className="py-3 px-4">
        <div className="flex flex-col">
          <span className="font-medium text-sm">{creator.nomeExibicao}</span>
          <span className="text-xs text-muted-foreground">@{creator.username}</span>
        </div>
      </td>

      {/* Taxa efectiva */}
      <td className="py-3 px-4">
        <span className="font-mono text-sm font-semibold">{creator.taxaEfectiva}%</span>
      </td>

      {/* Origem */}
      <td className="py-3 px-4">
        {creator.fonte === 'personalizada' ? (
          <Badge variant="default" className="text-xs bg-violet-500 hover:bg-violet-600">Personalizada</Badge>
        ) : (
          <Badge variant="outline" className="text-xs text-muted-foreground">Global</Badge>
        )}
      </td>

      {/* Acções */}
      <td className="py-3 px-4 text-right">
        {editing ? (
          <div className="flex items-center justify-end gap-2">
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-2">
                <Input
                  id={`commission-input-${creator.id}`}
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={inputValue}
                  onChange={e => { setInputValue(e.target.value); setError(''); }}
                  className="w-24 h-8 text-sm font-mono bg-card"
                  placeholder="0-100"
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') cancelEdit(); }}
                />
                <span className="text-sm text-muted-foreground">%</span>
                <Button
                  id={`commission-save-${creator.id}`}
                  size="sm"
                  variant="default"
                  className="h-8 px-2"
                  onClick={handleSave}
                  disabled={isSaving}
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
                <Button
                  id={`commission-cancel-${creator.id}`}
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2"
                  onClick={cancelEdit}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-1">
            {creator.comissaoPersonalizada !== null && (
              <Button
                id={`commission-reset-${creator.id}`}
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-muted-foreground hover:text-destructive"
                onClick={handleReset}
                disabled={isSaving}
                title="Remover override — volta à taxa global"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              id={`commission-edit-${creator.id}`}
              size="sm"
              variant="ghost"
              className="h-8 px-2"
              onClick={startEdit}
              disabled={isSaving}
              title="Editar taxa personalizada"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}

// ── Secção de comissões por criador ──────────────────────────────────────────

function CreatorCommissionsSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState('');

  const { data, isLoading, isError } = useQuery<CommissionOverview>({
    queryKey: ['commission-overview'],
    queryFn: adminApi.getCommissionOverview,
  });

  const setCommission = useMutation({
    mutationFn: ({ id, value }: { id: number; value: number | null }) =>
      adminApi.setCreatorCommission(id, value),
    onSuccess: (_, { value }) => {
      queryClient.invalidateQueries({ queryKey: ['commission-overview'] });
      toast({
        title: value !== null
          ? `Taxa personalizada de ${value}% guardada.`
          : 'Override removido. Criador volta à taxa global.',
      });
    },
    onError: (err: any) => {
      let msg = 'Erro ao guardar comissão.';
      try { msg = JSON.parse(err.message)?.error ?? err.message; } catch { msg = err.message; }
      toast({ title: 'Erro', description: msg, variant: 'destructive' });
    },
  });

  // Ordenar criadores: primeiro os que têm comissão personalizada (descendente),
  // depois os restantes alfabeticamente.
  const criadores = (data?.criadores ?? []).sort((a, b) => {
    if (a.comissaoPersonalizada !== null && b.comissaoPersonalizada === null) return -1;
    if (a.comissaoPersonalizada === null && b.comissaoPersonalizada !== null) return 1;
    return a.username.localeCompare(b.username);
  });

  const filtered = criadores.filter(c =>
    c.username.toLowerCase().includes(search.toLowerCase()) ||
    c.nomeExibicao.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle>Comissões por Criador</CardTitle>
        <CardDescription>
          Define uma taxa personalizada por criador, que sobrepõe a taxa global.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Campo de pesquisa */}
        <div className="relative max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            id="commission-search"
            placeholder="Pesquisar criador…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 bg-card"
          />
        </div>

        {isLoading && (
          <p className="text-sm text-muted-foreground py-4 text-center">A carregar criadores…</p>
        )}
        {isError && (
          <p className="text-sm text-destructive py-4 text-center">Erro ao carregar dados de comissão.</p>
        )}

        {!isLoading && !isError && (
          filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              {search ? 'Nenhum criador encontrado.' : 'Ainda não existem criadores na plataforma.'}
            </p>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    <th className="py-2.5 px-4 text-left font-medium text-muted-foreground">Criador</th>
                    <th className="py-2.5 px-4 text-left font-medium text-muted-foreground">Taxa Efectiva</th>
                    <th className="py-2.5 px-4 text-left font-medium text-muted-foreground">Origem</th>
                    <th className="py-2.5 px-4 text-right font-medium text-muted-foreground">Acções</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(creator => (
                    <CreatorCommissionRow
                      key={creator.id}
                      creator={creator}
                      onSave={(id, value) => setCommission.mutate({ id, value })}
                      isSaving={setCommission.isPending}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        <p className="text-xs text-muted-foreground">
          <strong>Personalizada</strong> — taxa específica deste criador.&ensp;
          <strong>Global</strong> — herda a taxa global configurada acima.&ensp;
          O ícone <RotateCcw className="inline h-3 w-3" /> remove o override e repõe a taxa global.
        </p>
      </CardContent>
    </Card>
  );
}

// ── Página principal de Comissões ─────────────────────────────────────────────

export default function Commissions() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [globalRate, setGlobalRate] = useState<number | null>(null);

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: adminApi.getSettings
  });

  const { data: commissionData } = useQuery({
    queryKey: ['commission-overview'],
    queryFn: adminApi.getCommissionOverview,
  });

  useEffect(() => {
    if (settings && globalRate === null) {
      setGlobalRate((settings as any).commission_rate?.value ?? 20);
    }
  }, [settings, globalRate]);

  const updateGlobalRate = useMutation({
    mutationFn: (rate: number) => adminApi.updateSettings({
      commission_rate: { value: rate },
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      // Também actualiza o overview para reflectir a nova taxa global
      queryClient.invalidateQueries({ queryKey: ['commission-overview'] });
      toast({ title: 'Taxa global guardada com sucesso' });
    },
    onError: (err: any) => {
      toast({ title: 'Erro ao guardar', description: err.message, variant: 'destructive' });
    }
  });

  if (isLoading || globalRate === null) return <div>A carregar dados...</div>;

  const totalComPersonalizada = (commissionData as any)?.criadores?.filter(
    (c: any) => c.comissaoPersonalizada !== null
  ).length ?? 0;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Comissões e Taxas</h1>
        <p className="text-muted-foreground">
          Gere a comissão cobrada pela plataforma, a nível global e por criador.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
         <Card className="border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Taxa Global Actual</CardTitle>
            <div className="p-2 rounded-md bg-violet-500/10">
              <Percent className="h-4 w-4 text-violet-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">
              {(commissionData as any)?.taxaGlobal ?? globalRate}%
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Overrides Activos</CardTitle>
            <div className="p-2 rounded-md bg-orange-500/10">
              <RotateCcw className="h-4 w-4 text-orange-500" />
            </div>
          </CardHeader>
          <CardContent>
             <div className="text-2xl font-bold font-mono">
              {totalComPersonalizada}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6">
        <Card className="border-border">
          <CardHeader>
            <CardTitle>Taxa da Plataforma — Global</CardTitle>
            <CardDescription>
              Aplica-se a todos os criadores sem taxa personalizada definida.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-end gap-4">
              <div className="space-y-2 max-w-[200px]">
                <Label>Taxa Global (%)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="global-commission-rate"
                    type="number"
                    min={0}
                    max={100}
                    value={globalRate}
                    onChange={e => setGlobalRate(Number(e.target.value))}
                    className="bg-card font-mono"
                  />
                  <span className="text-muted-foreground">%</span>
                </div>
              </div>
              <Button
                id="save-global-settings"
                onClick={() => updateGlobalRate.mutate(globalRate)}
                disabled={updateGlobalRate.isPending}
              >
                <Save className="mr-2 h-4 w-4" /> Guardar
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ── Secção de comissão por criador ────────────────────────── */}
        <CreatorCommissionsSection />
      </div>
    </div>
  );
}
