import { useState, useEffect, useCallback } from 'react';
import { DataTable, Column } from '@/components/tables/DataTable';
import { StatusBadge } from '@/components/badges/StatusBadge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { CheckCircle2, XCircle, Wallet, Clock, TrendingUp, Ban, FileText, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// ─── Shared localStorage keys (same as Xclusive frontend) ───────────────────
const MOCK_TOPUP_KEY = 'xclusive_topup_requests';
const MOCK_USERS_KEY = 'xclusive_mock_users';

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
  comprovantivoBase64?: string;
  comprovantivoNome?: string;
}

interface MockUser {
  id: number;
  username: string;
  saldo: number;
  [key: string]: any;
}

function getRequests(): TopUpRequest[] {
  try { return JSON.parse(localStorage.getItem(MOCK_TOPUP_KEY) || '[]'); } catch { return []; }
}

function saveRequests(reqs: TopUpRequest[]) {
  localStorage.setItem(MOCK_TOPUP_KEY, JSON.stringify(reqs));
}

function getUsers(): MockUser[] {
  try { return JSON.parse(localStorage.getItem(MOCK_USERS_KEY) || '[]'); } catch { return []; }
}

function saveUsers(users: MockUser[]) {
  localStorage.setItem(MOCK_USERS_KEY, JSON.stringify(users));
}

function PdfViewerDialog({ request, onClose }: { request: TopUpRequest | null; onClose: () => void }) {
  if (!request?.comprovantivoBase64) return null;

  function openInNewTab() {
    if (!request) return;
    const win = window.open();
    if (win) {
      win.document.write(
        `<html><head><title>${request.comprovantivoNome ?? 'Comprovativo'}</title></head>` +
        `<body style="margin:0"><embed src="${request.comprovantivoBase64}" type="application/pdf" width="100%" height="100%" /></body></html>`
      );
    }
  }

  return (
    <Dialog open={!!request} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl w-full h-[82vh] flex flex-col p-0 gap-0 bg-card border-border">
        <DialogHeader className="px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-base font-semibold">Comprovativo</DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                <span className="font-mono text-primary">{request.reference}</span>
                {' · '}@{request.username}
                {' · '}
                <span className="font-bold">{request.amount.toLocaleString('pt-PT')} Kz</span>
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={openInNewTab} className="gap-2 text-xs">
              <ExternalLink className="w-3.5 h-3.5" /> Abrir em nova aba
            </Button>
          </div>
        </DialogHeader>
        <div className="flex-1 overflow-hidden">
          <iframe
            src={request.comprovantivoBase64}
            title="Comprovativo PDF"
            className="w-full h-full border-0"
          />
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
    setRequests(getRequests());
  }, []);

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

  function handleApprove(req: TopUpRequest) {
    if (!confirm(`Aprovar carregamento de ${req.amount.toLocaleString('pt-PT')} Kz para @${req.username}?\n\nRef: ${req.reference}\n\nEsta ação adiciona o saldo imediatamente à conta do utilizador.`)) return;

    const allReqs = getRequests();
    const idx = allReqs.findIndex(r => r.id === req.id);
    if (idx === -1) return;

    // Credit the user's saldo
    const users = getUsers();
    const uIdx = users.findIndex(u => u.id === req.userId);
    if (uIdx === -1) {
      toast({ title: 'Utilizador não encontrado', description: 'A conta pode ter sido removida.', variant: 'destructive' });
      return;
    }
    users[uIdx].saldo = (users[uIdx].saldo ?? 0) + req.amount;
    saveUsers(users);

    // Mark request as approved
    allReqs[idx] = { ...allReqs[idx], status: 'aprovado', processadoEm: new Date().toISOString() };
    saveRequests(allReqs);
    setRequests([...allReqs]);

    toast({ title: 'Carregamento aprovado', description: `${req.amount.toLocaleString('pt-PT')} Kz adicionados à conta de @${req.username}.` });
  }

  function handleReject(req: TopUpRequest) {
    const nota = prompt(`Motivo da rejeição para @${req.username} (Ref: ${req.reference}):\n\nEste motivo fica registado internamente.`);
    if (nota === null) return; // cancelled

    const allReqs = getRequests();
    const idx = allReqs.findIndex(r => r.id === req.id);
    if (idx === -1) return;

    allReqs[idx] = {
      ...allReqs[idx],
      status: 'rejeitado',
      processadoEm: new Date().toISOString(),
      adminNota: nota || 'Sem motivo indicado',
    };
    saveRequests(allReqs);
    setRequests([...allReqs]);

    toast({ title: 'Pedido rejeitado', description: `Carregamento de @${req.username} rejeitado.`, variant: 'destructive' });
  }

  const columns: Column<TopUpRequest>[] = [
    {
      header: 'Referência',
      cell: (item) => (
        <span className="font-mono text-xs font-bold text-primary tracking-wider">{item.reference}</span>
      ),
    },
    {
      header: 'Utilizador',
      cell: (item) => (
        <div>
          <p className="font-medium text-sm">{item.nomeCompleto}</p>
          <p className="text-xs text-muted-foreground">@{item.username}</p>
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
        </span>
      ),
    },
    {
      header: 'Estado',
      cell: (item) => <StatusBadge status={item.status} />,
    },
    {
      header: 'Comprovativo',
      cell: (item) => item.comprovantivoBase64 ? (
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
          <Wallet className="h-5 w-5 text-yellow-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-yellow-300 mb-1">
              {pending.length} pedido{pending.length > 1 ? 's' : ''} aguarda{pending.length === 1 ? '' : 'm'} verificação
            </p>
            <p className="text-xs text-muted-foreground">
              Confirma no extrato bancário da Xclusive que a transferência chegou com a referência indicada antes de aprovar. O saldo é creditado imediatamente ao clicar em <strong className="text-foreground">Aprovar</strong>.
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
