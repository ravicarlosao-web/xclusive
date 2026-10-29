import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { DataTable, Column } from '@/components/tables/DataTable';
import { StatusBadge } from '@/components/badges/StatusBadge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { CheckCircle2, XCircle, ThumbsUp, Eye, PauseCircle, PlayCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';

export default function Withdrawals() {
  const [statusFilter, setStatusFilter] = useState('pendente');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: withdrawals, isLoading } = useQuery({
    queryKey: ['withdrawals', statusFilter],
    queryFn: () => adminApi.getWithdrawals(statusFilter !== 'all' ? { status: statusFilter } : undefined)
  });

  const updateWithdrawal = useMutation({
    mutationFn: ({ id, status, notes, motivo, ocultarMotivo }: { id: number, status: string, notes?: string, motivo?: string, ocultarMotivo?: boolean }) =>
      adminApi.updateWithdrawal(id, { status, ...(notes ? { notes } : {}), ...(motivo ? { motivo, ocultarMotivo: !!ocultarMotivo } : {}) }),
    onSuccess: () => {
      setReter(null); setReterMotivo(''); setReterOcultar(false);
      queryClient.invalidateQueries({ queryKey: ['withdrawals'] });
      toast({ title: 'Levantamento atualizado' });
    },
    onError: (err: any) => {
      // 409 = transição inválida (outro admin já decidiu); recarrega a lista
      queryClient.invalidateQueries({ queryKey: ['withdrawals'] });
      toast({ title: 'Não foi possível atualizar', description: String(err?.message ?? '').slice(0, 200), variant: 'destructive' });
    }
  });

  // Retenção (Termos para Criadoras, Art. 6.º): motivo obrigatório (10 a 500) e opção de não o detalhar à criadora.
  const [reter, setReter] = useState<{ id: number; amount: number; username: string } | null>(null);
  const [reterMotivo, setReterMotivo] = useState('');
  const [reterOcultar, setReterOcultar] = useState(false);
  const motivoReterOk = reterMotivo.trim().length >= 10 && reterMotivo.trim().length <= 500;

  // Dados de pagamento: só no detalhe de UM pedido; o servidor grava audit_log a cada visualização.
  const [details, setDetails] = useState<{ id: number; iban: string; nomeTitular: string; banco: string; amount: number } | null>(null);
  async function openDetails(id: number) {
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch('/api/admin/withdrawals/' + id, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const w = await res.json();
      setDetails({ id, amount: w.amount, iban: w.destinationDetails?.iban ?? '—', nomeTitular: w.destinationDetails?.nomeTitular ?? '—', banco: w.destinationDetails?.banco ?? '—' });
    } catch {
      toast({ title: 'Não foi possível obter os dados de pagamento', variant: 'destructive' });
    }
  }

  const columns: Column<any>[] = [
    { header: 'ID', accessorKey: 'id', className: 'w-16 font-mono text-muted-foreground' },
    {
      header: 'Criador',
      className: 'font-medium text-primary',
      cell: (item) => (
        <div className="flex flex-col gap-1">
          <span>{item.creatorUsername}</span>
          {item.creatorBanida && <span className="text-xs font-bold text-red-400" data-testid="criador-banido">Conta banida</span>}
        </div>
      ),
    },
    { 
      header: 'Valor', 
      cell: (item) => <span className="font-bold font-mono">{Number(item.amount).toLocaleString('pt-PT')} Kz</span>
    },
    { 
      header: 'Método / Conta',
      cell: (item) => (
        <div className="flex items-center gap-2">
          <span className="text-sm">{item.method}</span>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => openDetails(item.id)}>
            <Eye className="h-3.5 w-3.5 mr-1" /> Ver dados
          </Button>
        </div>
      )
    },
    { 
      header: 'Data do Pedido', 
      cell: (item) => <span className="text-muted-foreground text-sm">{format(new Date(item.criadoEm), 'dd MMM yyyy')}</span>
    },
    { 
      header: 'Estado', 
      cell: (item) => (
        <div className="flex flex-col gap-1">
          <StatusBadge status={item.status} />
          {item.status === 'retido' && item.retidoMotivo && (
            <span className="text-xs text-muted-foreground max-w-[16rem]" data-testid="retido-motivo-admin">
              {item.retidoMotivo}{item.retidoMotivoVisivel === false ? ' (escondido à criadora)' : ''}
            </span>
          )}
        </div>
      )
    },
    {
      header: 'Ações',
      className: 'text-right',
      cell: (item) => (
        <div className="flex justify-end gap-2">
          {item.status === 'retido' && (
            <Button
              size="sm"
              variant="outline"
              className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10 h-8 px-2"
              data-testid="libertar"
              disabled={updateWithdrawal.isPending}
              onClick={() => {
                if (confirm('Libertar este levantamento? Volta a "aprovado" (a pagar) e a criadora é notificada.')) {
                  updateWithdrawal.mutate({ id: item.id, status: 'aprovado' });
                }
              }}
            >
              <PlayCircle className="h-4 w-4 mr-1" /> Libertar
            </Button>
          )}
          {item.status === 'pendente' && (
            <Button
              size="sm"
              variant="outline"
              className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10 h-8 px-2"
              disabled={updateWithdrawal.isPending}
              onClick={() => updateWithdrawal.mutate({ id: item.id, status: 'aprovado' })}
            >
              <ThumbsUp className="h-4 w-4 mr-1" /> Aprovar
            </Button>
          )}
          {item.status === 'aprovado' && (
            <Button
              size="sm"
              variant="outline"
              className="border-green-500/30 text-green-500 hover:bg-green-500/10 h-8 px-2"
              disabled={updateWithdrawal.isPending}
              onClick={() => {
                const aviso = item.creatorBanida ? 'ATENÇÃO: a conta desta criadora está BANIDA. Confirma que queres mesmo pagar (ou retém o levantamento).\n\n' : '';
                if (confirm(aviso + 'Marcar como pago? Confirma que já transferiste o valor. Este passo é irreversível.')) {
                  updateWithdrawal.mutate({ id: item.id, status: 'pago' });
                }
              }}
            >
              <CheckCircle2 className="h-4 w-4 mr-1" /> Marcar Pago
            </Button>
          )}
          {(item.status === 'pendente' || item.status === 'aprovado') && (
            <Button
              size="sm"
              variant="outline"
              className="border-orange-500/40 text-orange-400 hover:bg-orange-500/10 h-8 px-2"
              data-testid="reter-abrir"
              disabled={updateWithdrawal.isPending}
              onClick={() => setReter({ id: item.id, amount: Number(item.amount), username: item.creatorUsername })}
            >
              <PauseCircle className="h-4 w-4 mr-1" /> Reter
            </Button>
          )}
          {(item.status === 'pendente' || item.status === 'retido') && (
            <Button
              size="sm"
              variant="outline"
              className="border-red-500/30 text-red-500 hover:bg-red-500/10 h-8 px-2"
              disabled={updateWithdrawal.isPending}
              onClick={() => {
                const reason = prompt('Motivo da rejeição (os ganhos voltam à criadora):');
                if (reason) {
                  updateWithdrawal.mutate({ id: item.id, status: 'rejeitado', notes: reason });
                }
              }}
            >
              <XCircle className="h-4 w-4 mr-1" /> Rejeitar
            </Button>
          )}
        </div>
      )
    }
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Levantamentos</h1>
          <p className="text-muted-foreground">Aprovação de pagamentos aos criadores.</p>
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px] bg-card">
            <SelectValue placeholder="Filtrar por estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="pendente">Pendentes</SelectItem>
            <SelectItem value="aprovado">Aprovados (a pagar)</SelectItem>
            <SelectItem value="pago">Pagos</SelectItem>
            <SelectItem value="retido">Retidos</SelectItem>
            <SelectItem value="rejeitado">Rejeitados</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable 
        columns={columns} 
        data={(withdrawals as any)?.data ?? withdrawals ?? []} 
        isLoading={isLoading}
      />

      <Dialog open={!!details} onOpenChange={(o) => { if (!o) setDetails(null); }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader><DialogTitle>Dados de pagamento · pedido #{details?.id}</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <div><p className="text-xs text-muted-foreground uppercase">Valor</p><p className="font-bold">{details ? Number(details.amount).toLocaleString('pt-PT') : ''} Kz</p></div>
            <div><p className="text-xs text-muted-foreground uppercase">Titular</p><p className="font-bold">{details?.nomeTitular}</p></div>
            <div><p className="text-xs text-muted-foreground uppercase">Banco</p><p className="font-bold">{details?.banco}</p></div>
            <div><p className="text-xs text-muted-foreground uppercase">IBAN</p><p className="font-bold font-mono tracking-wider select-all">{details?.iban}</p></div>
            <p className="text-xs text-muted-foreground">Esta consulta ficou registada no registo de auditoria.</p>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!reter} onOpenChange={(o) => { if (!o && !updateWithdrawal.isPending) { setReter(null); setReterMotivo(''); setReterOcultar(false); } }}>
        <DialogContent className="sm:max-w-[480px]" data-testid="reter-dialogo">
          <DialogHeader>
            <DialogTitle>Reter levantamento #{reter?.id}</DialogTitle>
            <DialogDescription>
              {reter ? `${reter.amount.toLocaleString('pt-PT')} Kz de @${reter.username}. ` : ''}Os ganhos ficam reservados (não são devolvidos) até libertares ou rejeitares. A criadora é notificada.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reter-motivo">Motivo (obrigatório, 10 a 500 caracteres; fica registado)</Label>
              <Textarea id="reter-motivo" data-testid="reter-motivo" rows={4} maxLength={500} value={reterMotivo} onChange={(e) => setReterMotivo(e.target.value)} />
              <p className="text-xs text-muted-foreground">{reterMotivo.trim().length}/500</p>
            </div>
            <div className="flex items-start gap-2">
              <Checkbox id="reter-ocultar" data-testid="reter-ocultar" checked={reterOcultar} onCheckedChange={(v) => setReterOcultar(v === true)} className="mt-0.5" />
              <Label htmlFor="reter-ocultar" className="text-sm leading-snug">Não detalhar o motivo (restrição legal). A criadora só vê que foi retido e o contacto legal.</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReter(null)} disabled={updateWithdrawal.isPending}>Cancelar</Button>
            <Button
              data-testid="reter-confirmar"
              className="bg-orange-700 hover:bg-orange-800 text-white"
              disabled={!motivoReterOk || updateWithdrawal.isPending}
              onClick={() => reter && updateWithdrawal.mutate({ id: reter.id, status: 'retido', motivo: reterMotivo.trim(), ocultarMotivo: reterOcultar })}
            >
              Reter levantamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
