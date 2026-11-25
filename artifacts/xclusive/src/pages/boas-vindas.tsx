import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ImagePlus, Info, Loader2, Trash2, CheckCircle2, AlertCircle } from 'lucide-react';
import {
  useGetBoasVindas, useSaveBoasVindas, useDeleteBoasVindas, getGetBoasVindasQueryKey, type BoasVindasConfig,
} from '@workspace/api-client-react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { enviarImagemMensagem } from '@/components/mensagens/imagemMensagem';
import {
  BV_ACCEPT_IMAGEM, BV_TEXTO_MAX, contarCaracteres, corpoParaGuardar, erroDoRascunho, textoErroBoasVindas, validarImagemBoasVindas,
} from '@/lib/boasVindas';

/**
 * Painel do Criador → «Mensagem de boas-vindas». Só criadoras verificadas (a API responde 403 às restantes).
 * O interruptor «Ativa» faz parte do rascunho e grava-se com o botão Guardar (um só gesto, sem estados a meio).
 */
export default function BoasVindasPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const elegivel = !!user && user.tipoConta === 'criador' && user.verificado === true;

  useEffect(() => {
    if (user && !elegivel) setLocation('/home');
  }, [user, elegivel, setLocation]);

  if (!elegivel) return null;
  return <Formulario />;
}

function Formulario() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const chave = getGetBoasVindasQueryKey();
  const { data: cfg, isLoading, isError, error, refetch } = useGetBoasVindas({ query: { queryKey: chave, retry: false } });
  const guardar = useSaveBoasVindas();
  const apagar = useDeleteBoasVindas();

  const [texto, setTexto] = useState('');
  const [midiaUrl, setMidiaUrl] = useState<string | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);   // blob local (já) ou URL do CDN
  const [ativa, setAtiva] = useState(false);
  const [aEnviar, setAEnviar] = useState(false);
  const [erro, setErro] = useState('');
  const [erroImagem, setErroImagem] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [confirmarApagar, setConfirmarApagar] = useState(false);
  const [semente, setSemente] = useState<string | null>(null);   // «atualizadoEm» já carregado para o rascunho
  const ficheiro = useRef<HTMLInputElement>(null);
  const blobAtual = useRef<string | null>(null);

  function largarBlob() { if (blobAtual.current) { URL.revokeObjectURL(blobAtual.current); blobAtual.current = null; } }
  useEffect(() => largarBlob, []);

  function aplicar(c: BoasVindasConfig) {
    largarBlob();
    setTexto(c.texto); setMidiaUrl(c.midiaUrl ?? null); setPrevia(c.midiaUrl ?? null); setAtiva(c.ativa);
  }
  // Primeira carga: o rascunho nasce da configuração guardada.
  useEffect(() => {
    if (cfg && semente === null) { aplicar(cfg); setSemente(cfg.atualizadoEm ?? 'vazia'); }
  }, [cfg, semente]);

  const bloqueada = !!cfg?.desativadaPorAdmin;
  const n = contarCaracteres(texto);
  const excedeu = n > BV_TEXTO_MAX;
  const problema = erroDoRascunho({ texto, midiaUrl, ativa });
  const alterado = !!cfg && (texto.trim() !== cfg.texto || (midiaUrl ?? null) !== (cfg.midiaUrl ?? null) || (!bloqueada && ativa !== cfg.ativa));
  const ocupado = guardar.isPending || apagar.isPending || aEnviar;
  const podeGuardar = !!cfg && !problema && alterado && !ocupado;

  async function escolherImagem(f: File | undefined) {
    if (!f) return;
    setErroImagem(''); setSucesso('');
    const m = validarImagemBoasVindas(f);
    if (m) { setErroImagem(m); return; }
    setAEnviar(true);
    try {
      const url = await enviarImagemMensagem(f);
      largarBlob(); blobAtual.current = URL.createObjectURL(f);
      setMidiaUrl(url); setPrevia(blobAtual.current);
    } catch (e) {
      setErroImagem(textoErroBoasVindas(e, 'enviar'));
    } finally {
      setAEnviar(false);
      if (ficheiro.current) ficheiro.current.value = '';
    }
  }
  function removerImagem() { largarBlob(); setMidiaUrl(null); setPrevia(null); setErroImagem(''); setSucesso(''); }

  async function aoGuardar() {
    if (!podeGuardar) return;
    setErro(''); setSucesso('');
    try {
      const r = await guardar.mutateAsync({ data: corpoParaGuardar({ texto, midiaUrl, ativa }) });
      queryClient.setQueryData(chave, r);
      aplicar(r);
      setSucesso(r.ativa ? 'Guardado. A mensagem está ativa para quem começar a seguir-te a partir de agora.' : 'Guardado. A mensagem está desativada: ninguém a recebe.');
    } catch (e) {
      setErro(textoErroBoasVindas(e, 'guardar'));
    }
  }
  async function aoApagar() {
    setConfirmarApagar(false); setErro(''); setSucesso('');
    try {
      await apagar.mutateAsync();
      const r = await refetch();
      if (r.data) aplicar(r.data);
      setSucesso('A mensagem de boas-vindas foi apagada.');
    } catch (e) {
      setErro(textoErroBoasVindas(e, 'apagar'));
    }
  }

  return (
    <div className="w-full max-w-5xl mx-auto p-4 sm:p-8 pb-24" data-testid="boas-vindas">
      <Link href="/definicoes/monetizacao" className="inline-flex min-h-[44px] items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Painel do Criador
      </Link>
      <div className="mt-2 mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight">Mensagem de boas-vindas</h1>
        <p className="mt-1 text-sm sm:text-base text-muted-foreground">Dá as boas-vindas, automaticamente, a quem começa a seguir-te.</p>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground" role="status" data-testid="bv-a-carregar"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> A carregar…</div>
      )}
      {isError && (
        <Card className="bg-card border-border" data-testid="bv-erro-carregar">
          <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p role="alert" className="text-sm text-destructive">{textoErroBoasVindas(error, 'carregar')}</p>
            <Button type="button" variant="outline" className="min-h-[44px]" onClick={() => refetch()}>Tentar novamente</Button>
          </CardContent>
        </Card>
      )}

      {cfg && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <div className="space-y-6 min-w-0">
            <div className="space-y-2" data-testid="bv-avisos">
              {cfg.plataformaAtiva === false && (
                <Aviso testid="bv-aviso-plataforma">As mensagens automáticas ainda não estão ativas na plataforma. Podes guardar a tua; começa a ser enviada quando forem ativadas.</Aviso>
              )}
              <Aviso testid="bv-aviso-novos">Só recebem a mensagem as pessoas que começarem a seguir-te depois de a ativares.</Aviso>
              <Aviso testid="bv-aviso-uma-vez">A mensagem é enviada uma vez por pessoa.</Aviso>
              {bloqueada && <Aviso testid="bv-aviso-admin">Esta mensagem foi desativada pela equipa da plataforma. Não a podes ativar.</Aviso>}
            </div>

            <Card className="bg-card border-border" data-testid="bv-cartao">
              <CardHeader>
                <CardTitle>A tua mensagem</CardTitle>
                <CardDescription>Texto, imagem ou os dois. Alterações só valem para quem começar a seguir-te depois de guardares.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <label htmlFor="bv-ativa" className="flex min-h-[44px] cursor-pointer items-center justify-between gap-4 rounded-lg border border-border px-3 py-2">
                  <span className="text-sm font-semibold">Ativa</span>
                  <Switch id="bv-ativa" data-testid="bv-ativa" checked={ativa && !bloqueada} disabled={bloqueada || ocupado} onCheckedChange={(v) => { setAtiva(v); setSucesso(''); }} aria-label="Ativa" />
                </label>

                <div className="space-y-2">
                  <Label htmlFor="bv-texto" className="text-sm font-semibold">Texto</Label>
                  <Textarea id="bv-texto" data-testid="bv-texto" value={texto} rows={6} disabled={ocupado} aria-invalid={excedeu} aria-describedby="bv-contador"
                    placeholder="Ex.: Olá! Obrigada por me seguires. Aqui vais encontrar…"
                    onChange={(e) => { setTexto(e.target.value); setSucesso(''); }} />
                  <div id="bv-contador" data-testid="bv-contador" className={`text-right text-xs ${excedeu ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}>
                    {n}/{BV_TEXTO_MAX}{excedeu ? ' — texto demasiado longo' : ''}
                  </div>
                </div>

                <div className="space-y-2">
                  <span className="text-sm font-semibold" id="bv-imagem-rotulo">Imagem (opcional)</span>
                  <p className="text-xs text-muted-foreground">JPG, PNG ou WebP, até 5 MB.</p>
                  <input ref={ficheiro} type="file" accept={BV_ACCEPT_IMAGEM} className="sr-only" tabIndex={-1} data-testid="bv-ficheiro" aria-labelledby="bv-imagem-rotulo" onChange={(e) => escolherImagem(e.target.files?.[0])} />
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" className="min-h-[44px] gap-2" disabled={ocupado} data-testid="bv-escolher" onClick={() => ficheiro.current?.click()}>
                      {aEnviar ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ImagePlus className="h-4 w-4" aria-hidden="true" />}
                      {aEnviar ? 'A enviar…' : midiaUrl ? 'Trocar imagem' : 'Escolher imagem'}
                    </Button>
                    {midiaUrl && (
                      <Button type="button" variant="ghost" className="min-h-[44px]" disabled={ocupado} data-testid="bv-remover-imagem" onClick={removerImagem}>Remover imagem</Button>
                    )}
                  </div>
                  {erroImagem && <p role="alert" data-testid="bv-erro-imagem" className="text-sm text-destructive">{erroImagem}</p>}
                </div>

                <div className="space-y-3">
                  {problema && !excedeu && (texto !== '' || midiaUrl === null) && <p data-testid="bv-dica" className="text-sm text-muted-foreground">{problema} Para tirar tudo, usa «Apagar».</p>}
                  {erro && <p role="alert" data-testid="bv-erro" className="flex items-start gap-2 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{erro}</p>}
                  {sucesso && <p role="status" data-testid="bv-sucesso" className="flex items-start gap-2 text-sm text-foreground"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />{sucesso}</p>}
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                    <Button type="button" variant="outline" className="min-h-[44px] gap-2" disabled={!cfg.configurada || ocupado} data-testid="bv-apagar" onClick={() => setConfirmarApagar(true)}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" /> Apagar
                    </Button>
                    <Button type="button" className="min-h-[44px] min-w-[8rem] font-bold" disabled={!podeGuardar} data-testid="bv-guardar" onClick={aoGuardar}>
                      {guardar.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> A guardar…</> : 'Guardar'}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <aside aria-label="Pré-visualização" className="min-w-0" data-testid="bv-previa">
            <Card className="bg-card border-border lg:sticky lg:top-6">
              <CardHeader>
                <CardTitle className="text-base">Como o seguidor vai ver</CardTitle>
                <CardDescription>Assim aparece na conversa dele contigo.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-start gap-2">
                  <img src={user?.avatarUrl ?? undefined} alt="" aria-hidden="true" className="h-8 w-8 shrink-0 rounded-full bg-secondary object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />
                  <div className="flex min-w-0 max-w-[85%] flex-col items-start gap-1">
                    {previa && <img src={previa} alt="Imagem da mensagem" data-testid="bv-previa-imagem" className="block h-auto max-h-[320px] w-auto max-w-full rounded-2xl border border-border bg-secondary object-contain" />}
                    {texto.trim() !== '' && (
                      <div data-testid="bv-previa-texto" className="whitespace-pre-wrap break-words rounded-2xl border border-border bg-secondary px-4 py-2 text-[15px] text-foreground">{texto.trim()}</div>
                    )}
                    {!previa && texto.trim() === '' && (
                      <div data-testid="bv-previa-vazia" className="rounded-2xl border border-dashed border-border px-4 py-2 text-sm text-muted-foreground">A tua mensagem aparece aqui.</div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </aside>
        </div>
      )}

      <AlertDialog open={confirmarApagar} onOpenChange={setConfirmarApagar}>
        <AlertDialogContent data-testid="bv-confirmar-apagar">
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar a mensagem de boas-vindas?</AlertDialogTitle>
            <AlertDialogDescription>Deixa de ser enviada a quem começar a seguir-te. As mensagens já entregues ficam como estão.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-[44px]" data-testid="bv-apagar-cancelar">Cancelar</AlertDialogCancel>
            <AlertDialogAction className="min-h-[44px] bg-primary text-white hover:bg-primary/90" data-testid="bv-apagar-confirmar" onClick={aoApagar}>Apagar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Aviso({ children, testid }: { children: React.ReactNode; testid: string }) {
  return (
    <div data-testid={testid} className="flex items-start gap-2 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}
