import { useState, useEffect, useCallback } from 'react';
import { DataTable, Column } from '@/components/tables/DataTable';
import { StatusBadge } from '@/components/badges/StatusBadge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { CheckCircle2, XCircle, Clock, TrendingUp, Ban, FileText, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { adminApi } from '@/lib/api';

import { MoneyIcon } from '@/components/icons/MoneyIcon';
interface TopUpRequest {
  id: string;
  userId: number;
  username: string;
  nomeCompleto: string;
  amount: number;
  reference: string;
  criadoEm: string;
  status: 'pendente' | 'aprovado' | 'rejeitado';
  processadoEm?: string;
  adminNota?: string;
  temComprovativo?: boolean;
  comprovantivoNome?: string;
  contaAtiva?: boolean;
  contaEstado?: 'ativa' | 'suspensa' | 'encerrada' | 'banida';
}

const DIAS_AVISO = 7;
const DIA_MS = 24 * 60 * 60 * 1000;

/** Idade do pedido em dias inteiros. */
function idadeDias(criadoEm: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(criadoEm).getTime()) / DIA_MS));
}

function textoIdade(criadoEm: string): string {
  const d = idadeDias(criadoEm);
  if (d >= 1) return `há ${d} dia${d === 1 ? '' : 's'}`;
  const h = Math.max(0, Math.floor((Date.now() - new Date(criadoEm).getTime()) / (60 * 60 * 1000)));
  return h >= 1 ? `há ${h} h` : 'há menos de 1 h';
}

/**
 * Converte o comprovativo (data URL) num Blob application/pdf. Nunca se interpola o ficheiro nem o nome em HTML:
 * o tipo é fixado aqui, por isso mesmo um conteúdo que não seja PDF nunca é tratado como HTML pelo browser.
 */
function blobDoComprovativo(dataUrl: string): Blob | null {
  const m = /^data:application\/pdf;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!m) return null;
  try {
    const bin = atob(m[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: 'application/pdf' });
  } catch {
    return null;
  }
}

function PdfViewerDialog({ request, onClose }: { request: TopUpRequest | null; onClose: () => void }) {
  // O ficheiro NÃO vem na lista: pede-se ao abrir (cada abertura fica registada no audit_log do servidor).
  const [ficheiro, setFicheiro] = useState<string | null>(null);
  const [aCarregar, setACarregar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  // O Blob nasce do ficheiro validado e o URL é revogado ao trocar/fechar.
  useEffect(() => {
    setBlobUrl(null);
    if (!ficheiro) return;
    const blob = blobDoComprovativo(ficheiro);
    if (!blob) { setErro('Comprovativo inválido: não é um PDF.'); return; }
    const url = URL.createObjectURL(blob);
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [ficheiro]);

  useEffect(() => {
    setFicheiro(null);
    setErro(null);
    if (!request?.temComprovativo) return;
    let cancelado = false;
    setACarregar(true);
    const token = localStorage.getItem('admin_token');
    fetch(`/api/admin/topups/${request.id}/comprovativo`, { headers: token ? { Authorization: 'Bearer ' + token } : {} })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
        if (!cancelado) setFicheiro(json.comprovantivoBase64 ?? null);
      })
      .catch((e: Error) => { if (!cancelado) setErro(e.message || 'Não foi possível abrir o comprovativo.'); })
      .finally(() => { if (!cancelado) setACarregar(false); });
    return () => { cancelado = true; };
  }, [request?.id, request?.temComprovativo]);

  if (!request?.temComprovativo) return null;

  function openInNewTab() {
    if (!blobUrl) return;
    window.open(blobUrl, '_blank', 'noopener,noreferrer');
  }

  return (
    <Dialog open={!!request} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl w-full h-[82vh] flex flex-col p-0 gap-0 bg-card border-border">
        <DialogHeader className="px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-base font-semibold">Comprovativo</DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                <span className="font-mono text-primary">#{request.id}</span>
                {' · '}@{request.username}
                {' · '}
                <span className="font-bold">{request.amount.toLocaleString('pt-PT')} Kz</span>
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={openInNewTab} disabled={!blobUrl} className="gap-2 text-xs">
              <ExternalLink className="w-3.5 h-3.5" /> Abrir em nova aba
            </Button>
          </div>
        </DialogHeader>
        <div className="flex-1 overflow-hidden">
          {aCarregar && <p className="p-6 text-sm text-muted-foreground" data-testid="comprovativo-a-carregar">A carregar o comprovativo…</p>}
          {erro && <p role="alert" className="p-6 text-sm text-destructive" data-testid="comprovativo-erro">{erro}</p>}
          {blobUrl && (
            <iframe
              src={blobUrl}
              sandbox=""
              title="Comprovativo PDF"
              className="w-full h-full border-0"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function TopUps() {
  const [requests, setRequests] = useState<TopUpRequest[]>([]);
  const [statusFilter, setStatusFilter] = useState('pendente');
  const [pdfPreview, setPdfPreview] = useState<TopUpRequest | null>(null);
  const { toast } = useToast();

  const refresh = useCallback(() => {
    adminApi.getTopups({ status: statusFilter, page: '1', limit: '100' })
      .then((result) => {
        const rows = Array.isArray(result) ? result : (result.data ?? []);
        setRequests(rows);
      })
      .catch(() => {
        toast({ title: 'Não foi possível carregar os pedidos', description: 'Tenta novamente dentro de instantes.', variant: 'destructive' });
      });
  }, [statusFilter, toast]);

  useEffect(() => {
    refresh();
    // Poll for new requests while the page is open
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  const filtered = statusFilter === 'all'
    ? requests
    : requests.filter(r => r.status === statusFilter);

  const pending = requests.filter(r => r.status === 'pendente');
  const approved = requests.filter(r => r.status === 'aprovado');
  const totalApproved = approved.reduce((s, r) => s + r.amount, 0);

  async function handleApprove(req: TopUpRequest) {
    const dias = idadeDias(req.criadoEm);
    const aviso = dias > DIAS_AVISO ? `\n\nATENÇÃO: este pedido tem ${dias} dias. Confirma a data da transferência no extrato.` : '';
    const contaAviso = req.contaAtiva === false ? `\n\nATENÇÃO: a conta está ${req.contaEstado ?? 'inativa'} — a aprovação será recusada.` : '';
    if (!confirm(`Aprovar carregamento de ${req.amount.toLocaleString('pt-PT')} Kz para @${req.username}?\n\nPedido #${req.id}${aviso}${contaAviso}\n\nEsta ação adiciona o saldo imediatamente à conta do utilizador.`)) return;

    try {
      await adminApi.updateTopup(Number(req.id), { status: 'aprovado' });
      await refresh();
      toast({ title: 'Carregamento aprovado', description: `${req.amount.toLocaleString('pt-PT')} Kz adicionados à conta de @${req.username}.` });
    } catch (error) {
      toast({ title: 'Não foi possível aprovar', description: error instanceof Error ? error.message : 'Tenta novamente.', variant: 'destructive' });
    }
  }

  async function handleReject(req: TopUpRequest) {
    const nota = prompt(`Motivo da rejeição para @${req.username} (pedido #${req.id}):\n\nEste motivo fica registado internamente.`);
    if (nota === null) return; // cancelled

    try {
      await adminApi.updateTopup(Number(req.id), { status: 'rejeitado', notas: nota || 'Sem motivo indicado' });
      await refresh();
      toast({ title: 'Pedido rejeitado', description: `Carregamento de @${req.username} rejeitado.`, variant: 'destructive' });
    } catch (error) {
      toast({ title: 'Não foi possível rejeitar', description: error instanceof Error ? error.message : 'Tenta novamente.', variant: 'destructive' });
    }
  }

  const columns: Column<TopUpRequest>[] = [
    {
      header: 'Pedido',
      cell: (item) => (
        <span className="font-mono text-xs font-bold text-primary tracking-wider">#{item.id}</span>
      ),
    },
    {
      header: 'Utilizador',
      cell: (item) => (
        <div>
          <p className="font-medium text-sm">{item.nomeCompleto}</p>
          <p className="text-xs text-muted-foreground">@{item.username}</p>
          {item.contaAtiva === false && (
            <p className="text-xs font-semibold text-red-400" data-testid={`conta-estado-${item.id}`}>Conta {item.contaEstado ?? 'inativa'}</p>
          )}
        </div>
      ),
    },
    {
      header: 'Valor',
      cell: (item) => (
        <span className="font-bold font-mono text-base">{item.amount.toLocaleString('pt-PT')} Kz</span>
      ),
    },
    {
      header: 'Data do Pedido',
      cell: (item) => (
        <span className="text-muted-foreground text-sm">
          {format(new Date(item.criadoEm), 'dd MMM yyyy, HH:mm')}
          {item.status === 'pendente' && (
            <span
              className={idadeDias(item.criadoEm) > DIAS_AVISO ? 'block text-xs font-semibold text-red-400' : 'block text-xs'}
              data-testid={`idade-${item.id}`}
            >
              {textoIdade(item.criadoEm)}{idadeDias(item.criadoEm) > DIAS_AVISO ? ' · antigo' : ''}
            </span>
          )}
        </span>
      ),
    },
    {
      header: 'Estado',
      cell: (item) => <StatusBadge status={item.status} />,
    },
    {
      header: 'Comprovativo',
      cell: (item) => item.temComprovativo ? (
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 gap-1.5 text-xs border-border text-muted-foreground hover:text-foreground"
          onClick={() => setPdfPreview(item)}
        >
          <FileText className="h-3.5 w-3.5" />
          {item.comprovantivoNome ?? 'comprovativo.pdf'}
        </Button>
      ) : (
        <span className="text-muted-foreground/40 text-xs">Sem anexo</span>
      ),
    },
    {
      header: 'Nota Admin',
      cell: (item) => item.adminNota
        ? <span className="text-xs text-muted-foreground italic">{item.adminNota}</span>
        : <span className="text-muted-foreground/40 text-xs">—</span>,
    },
    {
      header: 'Ações',
      className: 'text-right',
      cell: (item) => item.status === 'pendente' ? (
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            className="border-green-500/30 text-green-400 hover:bg-green-500/10 hover:text-green-300 h-8 px-2"
            onClick={() => handleApprove(item)}
          >
            <CheckCircle2 className="h-4 w-4 mr-1" /> Aprovar
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300 h-8 px-2"
            onClick={() => handleReject(item)}
          >
            <XCircle className="h-4 w-4 mr-1" /> Rejeitar
          </Button>
        </div>
      ) : (
        item.processadoEm
          ? <span className="text-xs text-muted-foreground">{format(new Date(item.processadoEm), 'dd/MM HH:mm')}</span>
          : null
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Carregamentos</h1>
          <p className="text-muted-foreground">
            Verificação manual de transferências bancárias e crédito de saldo.
          </p>
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px] bg-card">
            <SelectValue placeholder="Filtrar por estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="pendente">Pendentes</SelectItem>
            <SelectItem value="aprovado">Aprovados</SelectItem>
            <SelectItem value="rejeitado">Rejeitados</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-yellow-400">Pendentes</CardTitle>
            <Clock className="h-4 w-4 text-yellow-400" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-yellow-400">{pending.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {pending.reduce((s, r) => s + r.amount, 0).toLocaleString('pt-PT')} Kz em espera
            </p>
          </CardContent>
        </Card>

        <Card className="border-green-500/20 bg-green-500/5">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-400">Aprovados</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-400" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-400">{approved.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {totalApproved.toLocaleString('pt-PT')} Kz creditados
            </p>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Rejeitados</CardTitle>
            <Ban className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{requests.filter(r => r.status === 'rejeitado').length}</div>
            <p className="text-xs text-muted-foreground mt-1">transferências não confirmadas</p>
          </CardContent>
        </Card>
      </div>

      {/* Como funciona */}
      {pending.length > 0 && (
        <div className="flex items-start gap-3 bg-yellow-500/8 border border-yellow-500/20 rounded-xl p-4">
          <MoneyIcon className="h-5 w-5 text-yellow-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-yellow-300 mb-1">
              {pending.length} pedido{pending.length > 1 ? 's' : ''} aguarda{pending.length === 1 ? '' : 'm'} verificação
            </p>
            <p className="text-xs text-muted-foreground">
              Confirma o valor e a data no extrato bancário e confere o comprovativo. O saldo é creditado imediatamente ao clicar em <strong className="text-foreground">Aprovar</strong>.
            </p>
          </div>
        </div>
      )}

      <DataTable
        columns={columns}
        data={filtered}
        isLoading={false}
      />

      <PdfViewerDialog request={pdfPreview} onClose={() => setPdfPreview(null)} />
    </div>
  );
}
