import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { DataTable, Column } from '@/components/tables/DataTable';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { AlertTriangle, Eye } from 'lucide-react';

type Estado = 'pendente' | 'em_analise' | 'procedente' | 'improcedente';
const ESTADO_LABEL: Record<Estado, string> = { pendente: 'Pendente', em_analise: 'Em análise', procedente: 'Procedente', improcedente: 'Improcedente' };
const ESTADO_COR: Record<Estado, string> = {
  pendente: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
  em_analise: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  procedente: 'bg-red-500/10 text-red-400 border-red-500/20',
  improcedente: 'bg-green-500/10 text-green-400 border-green-500/20',
};
const MOTIVO_LABEL: Record<string, string> = {
  menor: 'Menor de idade', sem_consentimento: 'Sem consentimento', direitos_autor: 'Direitos de autor',
  violencia: 'Violência', assedio: 'Assédio', spam: 'Spam', outro: 'Outro',
};
const TIPO_LABEL: Record<string, string> = { post: 'Publicação', reel: 'Reel', story: 'Story', comment: 'Comentário', user: 'Perfil', live: 'Live' };

/** Pedidos autenticados ao admin (o IBAN/IP nunca passam por aqui; os URLs assinados vêm só do detalhe). */
async function adminCall(method: string, path: string, body?: unknown) {
  const token = localStorage.getItem('admin_token');
  const res = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json;
}

function EstadoBadge({ estado }: { estado: Estado }) {
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border uppercase tracking-wider ${ESTADO_COR[estado]}`}>{ESTADO_LABEL[estado]}</span>;
}

export default function Reports() {
  const [statusFilter, setStatusFilter] = useState('pendente');
  const [soUrgentes, setSoUrgentes] = useState(false);
  const [aberta, setAberta] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const { data: reports, isLoading } = useQuery({
    queryKey: ['reports', statusFilter, soUrgentes],
    queryFn: () => adminApi.getReports({
      ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
      ...(soUrgentes ? { urgente: '1' } : {}),
    }),
  });

  const columns: Column<any>[] = [
    { header: 'ID', accessorKey: 'id', className: 'w-16 font-mono text-muted-foreground' },
    {
      header: 'Alvo',
      cell: (item) => (
        <div className="flex items-center gap-2">
          {item.urgente && <span title="Prioridade: menor de idade" className="inline-flex items-center gap-1 text-[10px] font-bold bg-red-600 text-white px-2 py-1 rounded"><AlertTriangle className="h-3 w-3" /> URGENTE</span>}
          <span className="uppercase text-[10px] font-bold bg-muted px-2 py-1 rounded text-muted-foreground tracking-widest">{TIPO_LABEL[item.targetType] ?? item.targetType}</span>
          <span className="font-mono text-sm">#{item.targetId}</span>
        </div>
      ),
    },
    {
      header: 'Denunciante',
      cell: (item) => <span className="font-mono text-sm text-muted-foreground">{item.anonimo ? 'Anónimo (sem conta)' : `@${item.reporterUsername ?? item.reporterId}`}</span>,
    },
    { header: 'Motivo', cell: (item) => <span className="text-sm">{MOTIVO_LABEL[item.reason] ?? item.reason}</span> },
    { header: 'Data', cell: (item) => <span className="text-muted-foreground text-sm">{format(new Date(item.criadoEm), 'dd MMM, HH:mm')}</span> },
    { header: 'Estado', cell: (item) => <EstadoBadge estado={item.status} /> },
    {
      header: 'Ações',
      className: 'text-right',
      cell: (item) => (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" className="h-8 px-2" onClick={() => setAberta(item.id)}>
            <Eye className="h-4 w-4 mr-1" /> {item.status === 'procedente' || item.status === 'improcedente' ? 'Ver' : 'Analisar'}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Denúncias</h1>
          <p className="text-muted-foreground">Análise, retirada de conteúdo e decisões (tudo fica auditado). As urgentes aparecem primeiro.</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={soUrgentes} onChange={(e) => setSoUrgentes(e.target.checked)} /> Só urgentes
          </label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px] bg-card"><SelectValue placeholder="Filtrar por estado" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="pendente">Pendentes</SelectItem>
              <SelectItem value="em_analise">Em análise</SelectItem>
              <SelectItem value="procedente">Procedentes</SelectItem>
              <SelectItem value="improcedente">Improcedentes</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable columns={columns} data={(reports as any)?.data ?? reports ?? []} isLoading={isLoading} />

      {aberta !== null && (
        <DenunciaDialog
          id={aberta}
          onClose={() => { setAberta(null); queryClient.invalidateQueries({ queryKey: ['reports'] }); }}
        />
      )}
    </div>
  );
}

function DenunciaDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Cada abertura do detalhe grava audit_log no servidor (o conteúdo só é devolvido se o registo for gravado)
  const { data: d, isLoading, error } = useQuery({
    queryKey: ['report-detail', id],
    queryFn: () => adminCall('GET', `/admin/reports/${id}`),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  const [decisao, setDecisao] = useState<'em_analise' | 'procedente' | 'improcedente'>('procedente');
  const [retirar, setRetirar] = useState(true);
  const [suspender, setSuspender] = useState(false);
  const [avisarAutor, setAvisarAutor] = useState(true);
  const [avisarDenunciante, setAvisarDenunciante] = useState(true);
  const [motivo, setMotivo] = useState('');
  const [notas, setNotas] = useState('');

  const final = d && (d.status === 'procedente' || d.status === 'improcedente');

  const decidir = useMutation({
    mutationFn: () => adminApi.updateReport(id, {
      status: decisao,
      notes: notas || undefined,
      motivo: motivo || undefined,
      acoes: decisao === 'procedente'
        ? { retirar, suspender, avisarAutor, avisarDenunciante }
        : { avisarDenunciante: decisao === 'em_analise' ? false : avisarDenunciante },
    }),
    onSuccess: () => { toast({ title: 'Decisão registada' }); queryClient.invalidateQueries({ queryKey: ['reports'] }); onClose(); },
    onError: (e: any) => toast({ title: 'Não foi possível registar', description: String(e?.message ?? '').slice(0, 200), variant: 'destructive' }),
  });

  async function acaoDireta(path: string, method: string, body: unknown, ok: string, confirmacao?: string) {
    if (confirmacao && !confirm(confirmacao)) return;
    try {
      await adminCall(method, path, body);
      toast({ title: ok });
      queryClient.invalidateQueries({ queryKey: ['report-detail', id] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      onClose();
    } catch (e: any) {
      toast({ title: 'Não foi possível concluir', description: String(e?.message ?? '').slice(0, 200), variant: 'destructive' });
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Denúncia #{id}</DialogTitle></DialogHeader>
        {isLoading && <p className="text-sm text-muted-foreground">A carregar…</p>}
        {error && <p className="text-sm text-red-400">{String((error as Error).message)}</p>}
        {d && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <EstadoBadge estado={d.status} />
              {d.urgente && <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-red-600 text-white px-2 py-1 rounded"><AlertTriangle className="h-3 w-3" /> URGENTE</span>}
              <span className="text-muted-foreground">{TIPO_LABEL[d.targetType]} #{d.targetId} · {MOTIVO_LABEL[d.reason] ?? d.reason} · {d.totalDenunciasDoAlvo} denúncia(s) a este alvo</span>
            </div>

            <div className="rounded-lg border p-3 space-y-1">
              <p className="text-xs uppercase text-muted-foreground">Denunciante</p>
              <p>{d.reporterId ? `@${d.reporterUsername}` : `Anónimo — contacto: ${d.reporterContact ?? '—'}`}</p>
              <p className="text-xs uppercase text-muted-foreground pt-2">Texto do denunciante (imutável)</p>
              <p className="whitespace-pre-wrap">{d.description || '—'}</p>
            </div>

            <div className="rounded-lg border p-3 space-y-2">
              <p className="text-xs uppercase text-muted-foreground">Conteúdo denunciado</p>
              {!d.alvo.existe ? <p>O conteúdo já não existe.</p> : (
                <>
                  <p>Autor: {d.alvo.dono ? `@${d.alvo.dono.username}${d.alvo.dono.ativo ? '' : ' (suspenso)'}` : '—'} · {d.alvo.removido ? <strong className="text-red-400">RETIRADO</strong> : 'visível'}</p>
                  {d.alvo.resumo && <p className="whitespace-pre-wrap">{d.alvo.resumo}</p>}
                  <div className="grid grid-cols-2 gap-2">
                    {d.alvo.media.map((m: any, i: number) => m.url ? (
                      m.tipo === 'video'
                        ? <video key={i} src={m.url} controls className="w-full rounded" />
                        : <img key={i} src={m.url} alt="" className="w-full rounded" />
                    ) : <p key={i} className="text-xs text-muted-foreground">Média indisponível</p>)}
                  </div>
                </>
              )}
            </div>

            {d.adminNotes && <p className="text-xs text-muted-foreground">Notas internas: {d.adminNotes}</p>}

            {!final ? (
              <div className="rounded-lg border p-3 space-y-3">
                <p className="text-xs uppercase text-muted-foreground">Decisão</p>
                <div className="flex flex-wrap gap-4">
                  {(d.status === 'pendente' ? ['em_analise', 'procedente', 'improcedente'] : ['procedente', 'improcedente']).map((e) => (
                    <label key={e} className="flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" name="decisao" checked={decisao === e} onChange={() => setDecisao(e as any)} />
                      {e === 'em_analise' ? 'Em análise' : e === 'procedente' ? 'Procedente (agir)' : 'Improcedente (ignorar)'}
                    </label>
                  ))}
                </div>
                {decisao === 'procedente' && (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={retirar} onChange={(e) => setRetirar(e.target.checked)} /> Retirar o conteúdo</label>
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={suspender} onChange={(e) => setSuspender(e.target.checked)} /> Suspender o autor</label>
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={avisarAutor} onChange={(e) => setAvisarAutor(e.target.checked)} /> Avisar o autor</label>
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={avisarDenunciante} onChange={(e) => setAvisarDenunciante(e.target.checked)} /> Avisar o denunciante</label>
                  </div>
                )}
                {decisao === 'improcedente' && (
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={avisarDenunciante} onChange={(e) => setAvisarDenunciante(e.target.checked)} /> Avisar o denunciante</label>
                )}
                {decisao === 'procedente' && (
                  <input className="w-full rounded-md border bg-background px-3 py-2" placeholder="Motivo (visível ao autor)" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} />
                )}
                <textarea className="w-full rounded-md border bg-background px-3 py-2 min-h-[60px]" placeholder="Notas internas (nunca visíveis ao utilizador)" value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={1000} />
                <Button disabled={decidir.isPending} onClick={() => decidir.mutate()}>Registar decisão</Button>
              </div>
            ) : (
              <p className="text-muted-foreground">Decisão final tomada{d.acaoRetirou ? ' · conteúdo retirado' : ''}{d.acaoSuspendeu ? ' · autor suspenso' : ''}.</p>
            )}

            {d.alvo.existe && (
              <div className="flex flex-wrap gap-2 pt-1 border-t">
                {d.alvo.removido ? (
                  <>
                    <Button size="sm" variant="outline" onClick={() => acaoDireta(`/admin/content/${d.targetType}/${d.targetId}/repor`, 'POST', {}, 'Conteúdo reposto', 'Repor este conteúdo? Volta a ficar visível.')}>Repor conteúdo</Button>
                    {d.targetType !== 'user' && d.targetType !== 'comment' && d.targetType !== 'live' && (
                      <Button size="sm" variant="destructive" onClick={() => acaoDireta(`/admin/content/${d.targetType}/${d.targetId}/ficheiros`, 'DELETE', { confirmar: true }, 'Ficheiros eliminados', 'ELIMINAR os ficheiros deste conteúdo? Esta ação é irreversível e fica registada.')}>Eliminar ficheiros (irreversível)</Button>
                    )}
                  </>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => acaoDireta(`/admin/content/${d.targetType}/${d.targetId}/retirar`, 'POST', { motivo: motivo || undefined }, 'Conteúdo retirado', 'Retirar este conteúdo agora (fica escondido; nada é apagado)?')}>Retirar conteúdo já</Button>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
