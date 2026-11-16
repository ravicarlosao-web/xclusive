import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { adminApi } from '@/lib/api';
import { QrSvg } from '@/components/security/QrSvg';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ShieldCheck, ShieldOff, Copy, Download, RefreshCw, Smartphone } from 'lucide-react';

/**
 * Segurança da conta: verificação em dois passos (TOTP). Acessível a todos os admins e superadmins.
 * O segredo, a URI do QR e os códigos de recuperação vivem APENAS no estado deste ecrã: nunca vão para localStorage, sessionStorage, URL, consola nem estado global,
 * e desaparecem ao concluir, fechar ou sair do ecrã. Com `obrigatoria` (modo obrigatório no servidor) é a ÚNICA coisa que o painel mostra até a ativação estar concluída.
 */

const ANTI_GESTOR = { 'data-1p-ignore': 'true', 'data-lpignore': 'true', 'data-bwignore': 'true', 'data-form-type': 'other' } as const;
const rotuloCodigo = 'text-xs uppercase tracking-wider text-muted-foreground';

/** Campo de código de 6 dígitos: numérico, «one-time-code», sem ser tratado como palavra-passe pelos gestores. */
function CampoCodigo({ id, valor, onChange, autoFocus }: { id: string; valor: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className={rotuloCodigo}>Código de 6 dígitos</Label>
      <Input id={id} name={id} type="text" inputMode="numeric" pattern="[0-9 ]*" autoComplete="one-time-code" maxLength={7} required autoFocus={autoFocus} spellCheck={false}
        value={valor} onChange={(e) => onChange(e.target.value.replace(/[^0-9 ]/g, ''))} placeholder="000000" {...ANTI_GESTOR}
        className="bg-background/50 border-border h-11 font-mono text-center text-lg tracking-[0.4em]" />
    </div>
  );
}

/** Os 10 códigos de recuperação: mostrados UMA vez; só se fecha depois de marcar «Guardei estes códigos». */
function CodigosRecuperacao({ codigos, onConcluir }: { codigos: string[]; onConcluir: () => void }) {
  const [guardei, setGuardei] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const texto = useMemo(() => 'Xclusive — códigos de recuperação do painel de administração\nCada código só funciona uma vez. Guarde-os num sítio seguro, fora deste computador se possível.\n\n' + codigos.join('\n') + '\n', [codigos]);
  const descarregar = () => {
    const url = URL.createObjectURL(new Blob([texto], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'xclusive-codigos-recuperacao.txt';
    document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const copiar = () => { navigator.clipboard?.writeText(codigos.join('\n')).then(() => setCopiado(true)).catch(() => {}); };
  return (
    <AlertDialog open onOpenChange={() => { /* não se fecha por fora: só com «Guardei estes códigos» */ }}>
      <AlertDialogContent data-testid="dialogo-codigos" onEscapeKeyDown={(e) => e.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Códigos de recuperação</AlertDialogTitle>
          <AlertDialogDescription>
            Se perder o telemóvel, cada um destes códigos permite uma entrada. São mostrados <strong>uma única vez</strong>: depois de fechar este ecrã não é possível voltar a vê-los.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="grid grid-cols-2 gap-2 rounded border border-border bg-muted p-3 font-mono text-sm select-all" data-testid="lista-codigos" aria-label="Códigos de recuperação">
          {codigos.map((c) => <li key={c}>{c}</li>)}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={copiar}><Copy className="mr-1 h-3.5 w-3.5" />Copiar</Button>
          <Button type="button" variant="outline" size="sm" onClick={descarregar}><Download className="mr-1 h-3.5 w-3.5" />Descarregar .txt</Button>
          {copiado && <span role="status" className="self-center text-xs text-muted-foreground">Copiados.</span>}
        </div>
        <div className="flex items-start gap-2">
          <Checkbox id="guardei-codigos" checked={guardei} onCheckedChange={(v) => setGuardei(v === true)} className="mt-0.5" />
          <Label htmlFor="guardei-codigos" className="font-normal leading-snug">Guardei estes códigos</Label>
        </div>
        <AlertDialogFooter>
          <Button type="button" disabled={!guardei} onClick={onConcluir} data-testid="concluir-codigos">Concluir</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type Estado = { ativo: boolean; pendente: boolean; codigosRestantes: number; obrigatorio: boolean; disponivel: boolean };

export default function Seguranca({ obrigatoria = false }: { obrigatoria?: boolean }) {
  const { aposAtivarTotp, concluirAtivacaoObrigatoria, logout } = useAdminAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();

  const { data: estado, isLoading, isError } = useQuery<Estado>({ queryKey: ['totp-estado'], queryFn: adminApi.getTotpEstado, retry: false });

  // ── ativação ──
  const [fase, setFase] = useState<'inicio' | 'senha' | 'confirmar'>('inicio');
  const [palavraPasse, setPalavraPasse] = useState('');
  const [segredo, setSegredo] = useState<{ segredo: string; uri: string } | null>(null);
  const [codigo, setCodigo] = useState('');
  const [codigos, setCodigos] = useState<string[] | null>(null);
  const [erro, setErro] = useState('');
  const [aEnviar, setAEnviar] = useState(false);
  // ── regenerar / desativar ──
  const [dialogo, setDialogo] = useState<null | 'regenerar' | 'desativar'>(null);
  const [codigosDe, setCodigosDe] = useState<'ativacao' | 'regenerar'>('ativacao');
  const sairDoEcra = useRef(false);

  const limparTudo = () => { setPalavraPasse(''); setSegredo(null); setCodigo(''); setCodigos(null); setErro(''); };
  useEffect(() => () => { sairDoEcra.current = true; }, []);
  // Sair do ecrã (ou fechar o separador) apaga tudo o que é sensível; com códigos por guardar, avisa antes de sair.
  useEffect(() => {
    if (!codigos) return;
    const aviso = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', aviso);
    return () => window.removeEventListener('beforeunload', aviso);
  }, [codigos]);

  const iniciar = async (evt: React.FormEvent) => {
    evt.preventDefault(); setErro(''); setAEnviar(true);
    try {
      const r = await adminApi.iniciarTotp(palavraPasse);
      setSegredo({ segredo: r.segredo, uri: r.uri }); setFase('confirmar');
    } catch (e: any) { setErro(e?.message || 'Não foi possível iniciar a ativação.'); }
    finally { setPalavraPasse(''); setAEnviar(false); }
  };

  const confirmar = async (evt: React.FormEvent) => {
    evt.preventDefault(); setErro(''); setAEnviar(true);
    try {
      const r = await adminApi.confirmarTotp(codigo.replace(/\s+/g, ''));
      aposAtivarTotp(r.token);   // as outras sessões terminaram: guarda o token novo
      setSegredo(null); setCodigo('');   // o segredo já não é preciso: não fica em memória
      setCodigosDe('ativacao'); setCodigos(r.codigosRecuperacao);
      qc.invalidateQueries({ queryKey: ['totp-estado'] });
    } catch (e: any) { setErro(e?.message || 'Não foi possível confirmar o código.'); setCodigo(''); }
    finally { setAEnviar(false); }
  };

  const concluirCodigos = () => {
    const eraAtivacao = codigosDe === 'ativacao';
    limparTudo(); setFase('inicio'); setDialogo(null);
    if (obrigatoria && eraAtivacao) { concluirAtivacaoObrigatoria(); setLocation('/dashboard'); }
    toast({ title: eraAtivacao ? 'Verificação em dois passos ativada' : 'Códigos de recuperação renovados' });
  };

  const cancelarAtivacao = () => { limparTudo(); setFase('inicio'); };

  // ── regenerar ──
  const [codigoReg, setCodigoReg] = useState('');
  const regenerar = async (evt: React.FormEvent) => {
    evt.preventDefault(); setErro(''); setAEnviar(true);
    try {
      const r = await adminApi.regenerarCodigosTotp(codigoReg.replace(/\s+/g, ''));
      setDialogo(null); setCodigosDe('regenerar'); setCodigos(r.codigosRecuperacao);
      qc.invalidateQueries({ queryKey: ['totp-estado'] });
    } catch (e: any) { setErro(e?.message || 'Não foi possível renovar os códigos.'); }
    finally { setCodigoReg(''); setAEnviar(false); }
  };

  // ── desativar ──
  const [senhaDes, setSenhaDes] = useState('');
  const [codigoDes, setCodigoDes] = useState('');
  const desativar = async (evt: React.FormEvent) => {
    evt.preventDefault(); setErro(''); setAEnviar(true);
    try {
      await adminApi.desativarTotp(senhaDes, codigoDes.replace(/\s+/g, ''));
      setDialogo(null);
      qc.invalidateQueries({ queryKey: ['totp-estado'] });
      toast({ title: 'Verificação em dois passos desativada', description: 'A sua conta volta a entrar só com a palavra-passe.' });
    } catch (e: any) { setErro(e?.message || 'Não foi possível desativar.'); }
    finally { setSenhaDes(''); setCodigoDes(''); setAEnviar(false); }
  };
  const fecharDialogo = () => { setDialogo(null); setErro(''); setCodigoReg(''); setSenhaDes(''); setCodigoDes(''); };

  const segredoAgrupado = segredo?.segredo.replace(/(.{4})/g, '$1 ').trim() ?? '';

  const corpo = (
    <Card className="border-border/50 shadow-2xl bg-card/80 backdrop-blur-xl w-full max-w-xl">
      <CardHeader className="space-y-2 text-center pb-4">
        <div className="flex justify-center">{estado?.ativo ? <ShieldCheck className="h-8 w-8 text-primary" aria-hidden="true" /> : <ShieldOff className="h-8 w-8 text-muted-foreground" aria-hidden="true" />}</div>
        <CardTitle className="text-xl font-medium tracking-tight">Verificação em dois passos</CardTitle>
        <CardDescription className="text-xs">
          {obrigatoria
            ? 'A administração exige agora a verificação em dois passos. Ative-a para continuar: até lá não tem acesso a mais nada.'
            : 'Além da palavra-passe, a entrada pede um código gerado pela sua aplicação de autenticação.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading && <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" aria-label="A carregar" /></div>}
        {isError && <p role="alert" className="text-sm text-destructive">Não foi possível carregar o estado (a verificação em dois passos pode estar indisponível neste momento).</p>}

        {estado && (
          <div className="flex flex-wrap items-center gap-3" data-testid="estado-totp">
            <span className="text-sm text-muted-foreground">Estado:</span>
            {estado.ativo
              ? <Badge variant="outline" data-testid="badge-estado" className="border-green-600 bg-green-950 text-green-300">Ativa</Badge>
              : <Badge variant="outline" data-testid="badge-estado" className="border-border text-foreground">Inativa</Badge>}
            {estado.ativo && <span className="text-sm text-muted-foreground">Códigos de recuperação por usar: <strong data-testid="codigos-restantes">{estado.codigosRestantes}</strong></span>}
          </div>
        )}

        {estado && !estado.ativo && fase === 'inicio' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Vai precisar de uma aplicação de autenticação no telemóvel (por exemplo Google Authenticator, Microsoft Authenticator ou Aegis).</p>
            <Button type="button" className="w-full h-11" onClick={() => { setErro(''); setFase('senha'); }}><Smartphone className="mr-2 h-4 w-4" />Ativar verificação em dois passos</Button>
          </div>
        )}

        {estado && !estado.ativo && fase === 'senha' && (
          <form onSubmit={iniciar} className="space-y-4" data-testid="form-senha">
            <p className="text-sm text-muted-foreground">Para começar, confirme a sua palavra-passe.</p>
            <div className="space-y-1.5">
              <Label htmlFor="ativar-palavra-passe" className={rotuloCodigo}>Palavra-passe atual</Label>
              <Input id="ativar-palavra-passe" type="password" value={palavraPasse} onChange={(e) => setPalavraPasse(e.target.value)} required autoFocus autoComplete="current-password" className="bg-background/50 border-border h-11" />
            </div>
            {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={cancelarAtivacao}>Cancelar</Button>
              <Button type="submit" className="flex-1 h-11" disabled={aEnviar}>{aEnviar ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Continuar'}</Button>
            </div>
          </form>
        )}

        {estado && !estado.ativo && fase === 'confirmar' && segredo && (
          <form onSubmit={confirmar} className="space-y-4" data-testid="form-confirmar">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              <li>Abra a aplicação de autenticação e leia o código QR (ou introduza o segredo à mão).</li>
              <li>Escreva abaixo o código de 6 dígitos que a aplicação mostra.</li>
            </ol>
            <div className="flex justify-center"><QrSvg texto={segredo.uri} rotulo="Código QR para configurar a aplicação de autenticação" className="h-52 w-52 rounded bg-white" /></div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Não consegue ler o QR? Introduza este segredo (tipo «baseado no tempo»):</p>
              <code data-testid="segredo-manual" className="block rounded border border-border bg-muted px-3 py-2 text-center font-mono text-sm tracking-wider select-all break-all">{segredoAgrupado}</code>
            </div>
            <CampoCodigo id="codigo-ativar" valor={codigo} onChange={setCodigo} autoFocus />
            {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={cancelarAtivacao}>Cancelar</Button>
              <Button type="submit" className="flex-1 h-11" disabled={aEnviar}>{aEnviar ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirmar e ativar'}</Button>
            </div>
          </form>
        )}

        {estado?.ativo && (
          <div className="space-y-3">
            <Button type="button" variant="outline" className="w-full" onClick={() => { setErro(''); setCodigoReg(''); setDialogo('regenerar'); }}><RefreshCw className="mr-2 h-4 w-4" />Gerar novos códigos de recuperação</Button>
            <Button type="button" variant="outline" className="w-full" disabled={estado.obrigatorio} onClick={() => { setErro(''); setSenhaDes(''); setCodigoDes(''); setDialogo('desativar'); }}><ShieldOff className="mr-2 h-4 w-4" />Desativar verificação em dois passos</Button>
            {estado.obrigatorio && <p data-testid="aviso-obrigatorio" className="text-xs text-muted-foreground">A verificação em dois passos é obrigatória na administração, por isso não pode ser desativada.</p>}
          </div>
        )}

        {obrigatoria && <Button type="button" variant="ghost" className="w-full" onClick={logout}>Terminar sessão</Button>}
      </CardContent>
    </Card>
  );

  return (
    <>
      {obrigatoria
        ? <main className="min-h-screen w-full flex items-center justify-center bg-background px-4 py-8"><h1 className="sr-only">Segurança</h1>{corpo}</main>
        : <div className="flex justify-center p-4 md:p-8"><h1 className="sr-only">Segurança</h1>{corpo}</div>}

      {codigos && <CodigosRecuperacao codigos={codigos} onConcluir={concluirCodigos} />}

      <Dialog open={dialogo === 'regenerar'} onOpenChange={(o) => { if (!o) fecharDialogo(); }}>
        <DialogContent>
          <form onSubmit={regenerar} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Gerar novos códigos de recuperação</DialogTitle>
              <DialogDescription>Os códigos atuais deixam de funcionar. Introduza um código da aplicação para confirmar.</DialogDescription>
            </DialogHeader>
            <CampoCodigo id="codigo-regenerar" valor={codigoReg} onChange={setCodigoReg} autoFocus />
            {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
            <DialogFooter><Button type="button" variant="ghost" onClick={fecharDialogo}>Cancelar</Button><Button type="submit" disabled={aEnviar}>Gerar códigos</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogo === 'desativar'} onOpenChange={(o) => { if (!o) fecharDialogo(); }}>
        <DialogContent>
          <form onSubmit={desativar} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Desativar verificação em dois passos</DialogTitle>
              <DialogDescription>A conta passa a entrar só com a palavra-passe. Confirme com a palavra-passe e um código da aplicação.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="desativar-palavra-passe" className={rotuloCodigo}>Palavra-passe atual</Label>
              <Input id="desativar-palavra-passe" type="password" value={senhaDes} onChange={(e) => setSenhaDes(e.target.value)} required autoComplete="current-password" className="bg-background/50 border-border h-11" />
            </div>
            <CampoCodigo id="codigo-desativar" valor={codigoDes} onChange={setCodigoDes} />
            {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
            <DialogFooter><Button type="button" variant="ghost" onClick={fecharDialogo}>Cancelar</Button><Button type="submit" variant="destructive" disabled={aEnviar}>Desativar</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
