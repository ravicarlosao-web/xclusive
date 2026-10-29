import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRoute, useLocation, Link } from 'wouter';
import { adminApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';
import { EstadoCaso } from './index';

const ACAO: Record<string, string> = {
  abrir_caso: 'Caso aberto', menor_caso_aberto: 'Caso aberto', menor_confirmado: 'Caso confirmado', menor_caso_arquivado: 'Caso arquivado',
  menor_autoridade_registada: 'Comunicação à autoridade registada', menor_caso_visto: 'Caso consultado',
};

/** Linhas legíveis das ações tomadas (contagens guardadas no caso). */
function linhasAcoes(a: any): string[] {
  if (!a) return [];
  const out: string[] = [];
  const c = a.conteudoRetido;
  if (c) out.push(`Conteúdo retido ao abrir: ${c.posts} publicações, ${c.reels} reels, ${c.stories} stories, ${c.comentarios} comentários, ${c.lives} lives.`);
  if (typeof a.sessoesCopiadas === 'number') out.push(`Sessões copiadas antes de serem terminadas: ${a.sessoesCopiadas}.`);
  if (typeof a.levantamentosRetidos === 'number') out.push(`Levantamentos retidos ao abrir: ${a.levantamentosRetidos}.`);
  if (a.jaInativaAoAbrir) out.push('A conta já estava inativa antes de o caso ser aberto.');
  const f = a.confirmado;
  if (f) {
    out.push(`Bloqueios criados: ${f.bloqueios?.email ?? 0} email e ${f.bloqueios?.documento ?? 0} documento(s).`);
    out.push(`Subscrições canceladas: ${f.subscricoesCanceladas} (subscritores avisados: ${f.subscritoresNotificados}).`);
    out.push(`Denúncias dadas como procedentes: ${f.denunciasProcedentes}. Levantamentos retidos ao confirmar: ${f.levantamentosRetidos}.`);
  }
  if (a.arquivado) out.push(a.arquivado.contaReativada ? 'Conta reativada ao arquivar.' : 'A conta não foi reativada ao arquivar.');
  return out;
}

export default function MenorDetail() {
  const [, params] = useRoute('/menores/:id');
  const [, setLocation] = useLocation();
  const id = parseInt(params?.id || '0');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: c, isLoading, error } = useQuery({ queryKey: ['menor', id], queryFn: () => adminApi.getMenor(id), enabled: !!id, retry: false });

  // Acessos copiados (IP e user-agent): só se pedem quando o admin os quer ver; cada leitura fica registada.
  const [acessos, setAcessos] = useState<any[] | null>(null);
  const verAcessos = useMutation({
    mutationFn: () => adminApi.getMenorAcessos(id),
    onSuccess: (r: any) => { setAcessos(r.acessos ?? []); queryClient.invalidateQueries({ queryKey: ['menor', id] }); },
    onError: (e: Error) => toast({ variant: 'destructive', title: 'Não foi possível obter os acessos', description: e.message }),
  });

  // Decisão (confirmar ou arquivar): motivo (10 a 500) e confirmação escrevendo o username da conta.
  const [decisao, setDecisao] = useState<null | 'confirmar' | 'arquivar'>(null);
  const [motivo, setMotivo] = useState('');
  const [confirma, setConfirma] = useState('');
  const fechar = () => { setDecisao(null); setMotivo(''); setConfirma(''); };
  const decidir = useMutation({
    mutationFn: (d: 'confirmar' | 'arquivar') => (d === 'confirmar' ? adminApi.confirmarMenor(id, motivo.trim()) : adminApi.arquivarMenor(id, motivo.trim())),
    onSuccess: (_r, d) => { fechar(); queryClient.invalidateQueries({ queryKey: ['menor', id] }); queryClient.invalidateQueries({ queryKey: ['menores'] }); toast({ title: d === 'confirmar' ? 'Caso confirmado' : 'Caso arquivado' }); },
    onError: (e: Error) => toast({ variant: 'destructive', title: 'Não foi possível concluir', description: e.message }),
  });

  // Comunicação à autoridade
  const [aut, setAut] = useState({ autoridade: '', comunicadaEm: '', referencia: '' });
  const registar = useMutation({
    mutationFn: () => adminApi.registarAutoridadeMenor(id, { autoridade: aut.autoridade.trim(), comunicadaEm: new Date(aut.comunicadaEm).toISOString(), ...(aut.referencia.trim() ? { referencia: aut.referencia.trim() } : {}) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['menor', id] }); queryClient.invalidateQueries({ queryKey: ['menores'] }); toast({ title: 'Comunicação registada' }); },
    onError: (e: Error) => toast({ variant: 'destructive', title: 'Não foi possível registar', description: e.message }),
  });

  if (isLoading) return <div>A carregar...</div>;
  if (error || !c) return <div role="alert">Caso não encontrado.</div>;

  const username: string = c.conta?.username ?? '';
  const motivoOk = motivo.trim().length >= 10 && motivo.trim().length <= 500;
  const podeDecidir = motivoOk && confirma.trim() === username && !decidir.isPending;
  const autOk = aut.autoridade.trim().length >= 3 && aut.autoridade.trim().length <= 150 && !!aut.comunicadaEm && aut.referencia.length <= 100 && !registar.isPending;
  const preencherAutoridade = () => setAut({
    autoridade: c.autoridade ?? '', referencia: c.autoridadeReferencia ?? '',
    comunicadaEm: c.autoridadeComunicadaEm ? format(new Date(c.autoridadeComunicadaEm), "yyyy-MM-dd'T'HH:mm") : '',
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" aria-label="Voltar" onClick={() => setLocation('/menores')}><ArrowLeft className="h-5 w-5" /></Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight" data-testid="caso-titulo">Caso #{c.id}</h1>
            <EstadoCaso estado={c.estado} />
          </div>
          <p className="text-muted-foreground">
            Conta <Link href={`/users/${c.conta?.id}`} className="text-primary underline">@{username}</Link> ({c.conta?.estado})
            {c.denuncia && <> · Denúncia #{c.denuncia.id} ({c.denuncia.status})</>}
          </p>
        </div>
        {c.estado === 'aberto' && (
          <div className="flex gap-2">
            <Button variant="outline" data-testid="caso-arquivar" onClick={() => setDecisao('arquivar')}>Não confirmar</Button>
            <Button className="bg-red-700 hover:bg-red-800 text-white" data-testid="caso-confirmar" onClick={() => setDecisao('confirmar')}>Confirmar</Button>
          </div>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Registo</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p><span className="text-muted-foreground">Aberto em:</span> {format(new Date(c.abertoEm), 'dd/MM/yyyy HH:mm')} por @{c.abertoPorUsername}</p>
            <div><p className="text-muted-foreground">Descrição</p><p className="whitespace-pre-wrap" data-testid="caso-descricao">{c.descricao}</p></div>
            {c.decisaoEm && (
              <div data-testid="caso-decisao">
                <p className="text-muted-foreground">Decisão</p>
                <p>{c.estado === 'confirmado' ? 'Confirmado' : 'Não confirmado'} em {format(new Date(c.decisaoEm), 'dd/MM/yyyy HH:mm')} por @{c.decisaoPorUsername}</p>
                <p className="whitespace-pre-wrap">{c.decisaoMotivo}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Ações tomadas</CardTitle></CardHeader>
          <CardContent>
            <ul className="list-disc pl-5 space-y-1 text-sm" data-testid="caso-acoes">
              {linhasAcoes(c.acoes).map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Comunicação à autoridade</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {c.autoridade ? (
              <p data-testid="autoridade-resumo">
                {c.autoridade} · {format(new Date(c.autoridadeComunicadaEm), 'dd/MM/yyyy HH:mm')}{c.autoridadeReferencia ? ` · Ref. ${c.autoridadeReferencia}` : ''} (registado por @{c.autoridadeRegistadaPorUsername})
              </p>
            ) : <p className="text-muted-foreground" data-testid="autoridade-resumo">Ainda sem comunicação registada.</p>}
            <div className="space-y-2" onFocus={() => { if (!aut.autoridade && c.autoridade) preencherAutoridade(); }}>
              <Label htmlFor="aut-nome">Autoridade</Label>
              <Input id="aut-nome" data-testid="aut-nome" value={aut.autoridade} maxLength={150} onChange={(e) => setAut({ ...aut, autoridade: e.target.value })} />
              <Label htmlFor="aut-data">Data e hora da comunicação</Label>
              <Input id="aut-data" type="datetime-local" data-testid="aut-data" value={aut.comunicadaEm} onChange={(e) => setAut({ ...aut, comunicadaEm: e.target.value })} />
              <Label htmlFor="aut-ref">Referência (opcional)</Label>
              <Input id="aut-ref" data-testid="aut-ref" value={aut.referencia} maxLength={100} onChange={(e) => setAut({ ...aut, referencia: e.target.value })} />
              <Button data-testid="aut-registar" disabled={!autOk} onClick={() => registar.mutate()}>{c.autoridade ? 'Atualizar registo' : 'Registar comunicação'}</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Acessos preservados</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">Cópia das sessões (IP e user-agent) feita antes de serem terminadas: {c.acessosPreservadosTotal}. Cada leitura fica registada.</p>
            {acessos === null ? (
              <Button variant="outline" data-testid="acessos-ver" disabled={verAcessos.isPending || c.acessosPreservadosTotal === 0} onClick={() => verAcessos.mutate()}>Mostrar acessos</Button>
            ) : (
              <ul className="space-y-1 font-mono text-xs" data-testid="acessos-lista">
                {acessos.map((a, i) => <li key={i}>{a.ip ?? '—'} · {a.userAgent ?? '—'} · {a.criadaEm ? format(new Date(a.criadaEm), 'dd/MM/yyyy HH:mm') : '—'}</li>)}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Linha do tempo</CardTitle></CardHeader>
        <CardContent>
          <ol className="space-y-1 text-sm" data-testid="caso-linha">
            {c.linhaDoTempo.map((l: any, i: number) => (
              <li key={i}>{format(new Date(l.em), 'dd/MM/yyyy HH:mm')} · {ACAO[l.acao] ?? l.acao}{l.adminUsername ? ` · @${l.adminUsername}` : ''}</li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Dialog open={decisao !== null} onOpenChange={(o) => { if (!o && !decidir.isPending) fechar(); }}>
        <DialogContent data-testid="decisao-dialogo">
          <DialogHeader>
            <DialogTitle>{decisao === 'confirmar' ? `Confirmar o caso de @${username}` : `Não confirmar o caso de @${username}`}</DialogTitle>
            <DialogDescription>
              {decisao === 'confirmar'
                ? 'Definitivo: a conta é banida, o email e o documento ficam bloqueados, as subscrições são canceladas, o conteúdo fica retido e os levantamentos retidos.'
                : 'O caso é arquivado e a conta é reativada (se estava ativa antes). Os levantamentos e o conteúdo mantêm-se retidos até decidires em separado.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="decisao-motivo">Motivo da decisão (obrigatório, 10 a 500 caracteres; fica registado)</Label>
              <Textarea id="decisao-motivo" data-testid="decisao-motivo" rows={4} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
              <p className="text-xs text-muted-foreground">{motivo.trim().length}/500</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="decisao-confirma">Para confirmar, escreve o username: <strong>{username}</strong></Label>
              <Input id="decisao-confirma" data-testid="decisao-confirma" autoComplete="off" value={confirma} onChange={(e) => setConfirma(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={fechar} disabled={decidir.isPending}>Cancelar</Button>
            <Button data-testid="decisao-confirmar" className={decisao === 'confirmar' ? 'bg-red-700 hover:bg-red-800 text-white' : 'bg-slate-700 hover:bg-slate-800 text-white'} disabled={!podeDecidir} onClick={() => decisao && decidir.mutate(decisao)}>
              {decisao === 'confirmar' ? 'Confirmar o caso' : 'Arquivar o caso'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
