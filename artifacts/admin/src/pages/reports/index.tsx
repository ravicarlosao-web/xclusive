import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { DataTable, Column } from '@/components/tables/DataTable';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { AlertTriangle, Eye } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { Textarea } from '@/components/ui/textarea';
import { AcoesMais18, ResumoInfracaoMais18, TIPOS_MAIS18, useResumoInfracao, type TipoMais18 } from '@/components/mais18/AcoesMais18';

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
  violencia: 'Violência', assedio: 'Assédio', spam: 'Spam', conteudo_mais18_nao_marcado: 'Conteúdo +18 não marcado', outro: 'Outro',
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
  const [marcarMais18, setMarcarMais18] = useState(false);
  const [confirmarInfracao, setConfirmarInfracao] = useState(false);
  // Abrir caso (denúncia de menor): suspensão preventiva da conta do autor, com descrição obrigatória (10 a 2000).
  const [, setLocation] = useLocation();
  const [casoAberto, setCasoAberto] = useState(false);
  const [casoDescricao, setCasoDescricao] = useState('');
  const abrirCaso = useMutation({
    mutationFn: () => adminApi.abrirMenor({ userId: d.alvo.dono.id, descricao: casoDescricao.trim(), reportId: d.id }),
    onSuccess: (r: any) => { queryClient.invalidateQueries({ queryKey: ['report-detail', id] }); setLocation(`/menores/${r.id}`); },
    onError: (e: Error) => toast({ variant: 'destructive', title: 'Não foi possível abrir o caso', description: e.message }),
  });

  const final = d && (d.status === 'procedente' || d.status === 'improcedente');

  // Marcar +18 e registar infração: só post/reel/story/live, com a criadora identificada e o conteúdo ainda NÃO marcado
  const podeMarcarMais18 = !!d && !final && d.alvo?.existe && TIPOS_MAIS18.includes(d.targetType) && d.alvo.mais18 === false && !!d.alvo.dono?.id;
  const resumoInfracao = useResumoInfracao(d?.alvo?.dono?.id, confirmarInfracao);
  const ligarMarcarMais18 = (v: boolean) => {
    setMarcarMais18(v);
    if (v) { setRetirar(false); setSuspender(false); } // a infração já aplica a sanção: exclusivo com retirar e suspender
  };
  // Denúncia "conteúdo +18 não marcado": a ação vem pré-selecionada (e retirar desligada)
  useEffect(() => {
    if (podeMarcarMais18 && d.reason === 'conteudo_mais18_nao_marcado') ligarMarcarMais18(true);
  }, [podeMarcarMais18, d?.reason]); // eslint-disable-line react-hooks/exhaustive-deps

  const decidir = useMutation({
    mutationFn: () => adminApi.updateReport(id, {
      status: decisao,
      notes: notas || undefined,
      motivo: motivo || undefined,
      acoes: decisao === 'procedente'
        ? { retirar, suspender, avisarAutor, avisarDenunciante, ...(podeMarcarMais18 && marcarMais18 ? { marcarMais18: true } : {}) }
        : { avisarDenunciante: decisao === 'em_analise' ? false : avisarDenunciante },
    }),
    onSuccess: () => { toast({ title: 'Decisão registada' }); queryClient.invalidateQueries({ queryKey: ['reports'] }); onClose(); },
    onError: (e: any) => {
      setConfirmarInfracao(false);
      // adminFetch devolve o corpo em bruto ({"error":"..."}): mostra só a mensagem do servidor (ex.: 409 com texto claro)
      let msg = String(e?.message ?? '');
      try { const j = JSON.parse(msg); if (typeof j?.error === 'string') msg = j.error; } catch { /* não é JSON */ }
      toast({ title: 'Não foi possível registar', description: msg.slice(0, 300), variant: 'destructive' });
    },
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

            {d.reason === 'menor' && d.alvo?.dono?.id && (
              <div className="rounded-lg border border-red-500/40 p-3 space-y-2" data-testid="caso-bloco">
                <p className="text-xs uppercase text-muted-foreground">Caso</p>
                {d.casoMenor ? (
                  <p>Esta conta já tem o <Link href={`/menores/${d.casoMenor.id}`} className="text-primary underline" data-testid="caso-ligacao">caso #{d.casoMenor.id}</Link> ({d.casoMenor.estado}).</p>
                ) : !casoAberto ? (
                  <Button variant="outline" size="sm" className="border-red-500/50 text-red-400" data-testid="caso-abrir" onClick={() => setCasoAberto(true)}>Abrir caso</Button>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">Suspende a conta de @{d.alvo.dono.username}, retira todo o conteúdo e retém os levantamentos pendentes e aprovados. Nada se apaga.</p>
                    <label htmlFor="caso-descricao" className="text-xs">Descrição (obrigatória, 10 a 2000 caracteres)</label>
                    <Textarea id="caso-descricao" data-testid="caso-descricao-nova" rows={3} maxLength={2000} value={casoDescricao} onChange={(e) => setCasoDescricao(e.target.value)} />
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setCasoAberto(false)} disabled={abrirCaso.isPending}>Cancelar</Button>
                      <Button size="sm" className="bg-red-700 hover:bg-red-800 text-white" data-testid="caso-abrir-confirmar" disabled={casoDescricao.trim().length < 10 || abrirCaso.isPending} onClick={() => abrirCaso.mutate()}>Abrir caso e suspender a conta</Button>
                    </div>
                  </div>
                )}
              </div>
            )}

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
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={retirar} disabled={marcarMais18} onChange={(e) => setRetirar(e.target.checked)} /> Retirar o conteúdo</label>
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={suspender} disabled={marcarMais18} onChange={(e) => setSuspender(e.target.checked)} /> Suspender o autor</label>
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={avisarAutor} onChange={(e) => setAvisarAutor(e.target.checked)} /> Avisar o autor</label>
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={avisarDenunciante} onChange={(e) => setAvisarDenunciante(e.target.checked)} /> Avisar o denunciante</label>
                    {podeMarcarMais18 && (
                      <label className="col-span-2 flex items-center gap-1.5 rounded-md border border-red-500/40 px-2 py-1.5 text-red-400" data-testid="acao-marcar-mais18">
                        <input type="checkbox" checked={marcarMais18} onChange={(e) => ligarMarcarMais18(e.target.checked)} /> Marcar +18 e registar infração
                        <span className="text-xs text-muted-foreground">(substitui retirar/suspender e o aviso genérico ao autor)</span>
                      </label>
                    )}
                  </div>
                )}
                {decisao === 'improcedente' && (
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={avisarDenunciante} onChange={(e) => setAvisarDenunciante(e.target.checked)} /> Avisar o denunciante</label>
                )}
                {decisao === 'procedente' && (
                  <input className="w-full rounded-md border bg-background px-3 py-2" placeholder="Motivo (visível ao autor)" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} />
                )}
                <textarea className="w-full rounded-md border bg-background px-3 py-2 min-h-[60px]" placeholder="Notas internas (nunca visíveis ao utilizador)" value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={1000} />
                <Button disabled={decidir.isPending}
                  onClick={() => { if (decisao === 'procedente' && podeMarcarMais18 && marcarMais18) setConfirmarInfracao(true); else decidir.mutate(); }}>Registar decisão</Button>
              </div>
            ) : (
              <p className="text-muted-foreground">Decisão final tomada{d.acaoRetirou ? ' · conteúdo retirado' : ''}{d.acaoSuspendeu ? ' · autor suspenso' : ''}.</p>
            )}

            <Dialog open={confirmarInfracao} onOpenChange={(o) => { if (!o && !decidir.isPending) setConfirmarInfracao(false); }}>
              <DialogContent className="sm:max-w-[480px]" data-testid="dialogo-decisao-infracao">
                <DialogHeader>
                  <DialogTitle>Confirmar decisão: marcar +18 e registar infração</DialogTitle>
                  <DialogDescription>A denúncia fica procedente, o conteúdo passa a +18 e é registada uma infração à criadora. O aviso da infração substitui o aviso genérico ao autor.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3 text-sm">
                  <ResumoInfracaoMais18 donoId={d.alvo?.dono?.id} resumo={resumoInfracao} />
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setConfirmarInfracao(false)} disabled={decidir.isPending}>Cancelar</Button>
                  <Button variant={resumoInfracao.suspende ? 'destructive' : 'default'}
                    disabled={decidir.isPending || resumoInfracao.infr.isLoading || !!resumoInfracao.infr.error}
                    data-testid="confirmar-decisao-infracao" onClick={() => decidir.mutate()}>
                    {resumoInfracao.suspende ? 'Confirmar, registar infração e suspender' : 'Confirmar e registar infração'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {d.alvo.existe && TIPOS_MAIS18.includes(d.targetType) && typeof d.alvo.mais18 === 'boolean' && (
              <div className="rounded-lg border p-3 space-y-1">
                <p className="text-xs uppercase text-muted-foreground">Marcação +18</p>
                <AcoesMais18 tipo={d.targetType as TipoMais18} id={d.targetId} donoId={d.alvo.dono?.id} mais18={d.alvo.mais18} />
              </div>
            )}

            {d.alvo.existe && (
              <div className="flex flex-wrap gap-2 pt-1 border-t">
                {d.alvo.removido ? (
                  <>
                    <Button size="sm" variant="outline" onClick={() => acaoDireta(`/admin/content/${d.targetType}/${d.targetId}/repor`, 'POST', {}, 'Conteúdo reposto', 'Repor este conteúdo? Volta a ficar visível.')}>Repor conteúdo</Button>
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
