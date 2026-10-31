import { useEffect, useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { format } from 'date-fns';
import { AlertTriangle, Coins, Flag, ImageOff, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/** Os URLs assinados das cópias de prova duram 5 minutos (PROVA_URL_TTL_SECONDS no servidor). */
const VALIDADE_URL_MS = 5 * 60 * 1000;

interface ImagemExcerto { copiaEstado?: 'ok' | 'falhou'; provaUrl?: string | null; sha256?: string | null; bytes?: number | null; motivo?: string }
interface MensagemExcerto {
  id: number; autorId: number; papel: 'denunciado' | 'denunciante'; tipo: string; conteudo?: string | null; criadoEm: string;
  retirada?: boolean; principal?: boolean; imagem?: ImagemExcerto; gorjeta?: { valor: number; comissao: number; purchaseId: number | null };
}
export interface ExcertoDaMensagem {
  conversaId?: number; mensagemId?: number; copiaEstado?: 'ok' | 'falhou' | 'nao_aplicavel';
  janela?: { antes: number; depois: number; maximo: number }; mensagens: MensagemExcerto[];
}

const kz = (v: number) => `${Number(v).toLocaleString('pt-PT')} Kz`;
const hora = (iso: string) => { try { return format(new Date(iso), 'dd MMM yyyy, HH:mm'); } catch { return ''; } };

/**
 * Excerto CONGELADO de uma denúncia de mensagem (só o que está na prova: nunca a conversa viva). Cronológico, com o papel de cada autor,
 * a mensagem denunciada em destaque, imagens pela cópia de prova (miniatura → ampliação, sem descarregar) e gorjetas sem saldos.
 */
export function ExcertoMensagem({ excerto, denunciante, denunciado, sha256, capturadoEm, carregadoEm, aRecarregar, onRecarregar }: {
  excerto: ExcertoDaMensagem | null; denunciante: string; denunciado: string; sha256?: string | null; capturadoEm?: string | null;
  carregadoEm: number; aRecarregar: boolean; onRecarregar: () => void;
}) {
  const [ampliada, setAmpliada] = useState<{ url: string; autor: string } | null>(null);
  const [imgComErro, setImgComErro] = useState(false);
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setAgora(Date.now()), 15000); return () => clearInterval(t); }, []);
  useEffect(() => { setImgComErro(false); setAgora(Date.now()); }, [carregadoEm]);
  const urlsExpirados = imgComErro || agora - carregadoEm > VALIDADE_URL_MS;
  const mensagens = excerto?.mensagens ?? [];
  const haImagensComUrl = mensagens.some((m) => m.imagem?.provaUrl);
  const nome = (m: MensagemExcerto) => `@${m.papel === 'denunciado' ? denunciado : denunciante}`;

  return (
    <div className="space-y-3" data-testid="excerto-mensagem">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs" data-testid="excerto-prova">
        <dt className="text-muted-foreground">Denunciado</dt><dd className="min-w-0 break-words">@{denunciado}</dd>
        <dt className="text-muted-foreground">Denunciante</dt><dd className="min-w-0 break-words">@{denunciante}</dd>
        <dt className="text-muted-foreground">Capturado em</dt><dd>{capturadoEm ? hora(capturadoEm) : '—'}</dd>
        <dt className="text-muted-foreground">SHA-256</dt><dd className="min-w-0 break-all font-mono" data-testid="excerto-hash">{sha256 ?? '—'}</dd>
        {excerto?.janela && (<><dt className="text-muted-foreground">Contexto</dt><dd>{excerto.janela.antes} antes e {excerto.janela.depois} depois (máx. {excerto.janela.maximo})</dd></>)}
      </dl>

      {excerto?.copiaEstado === 'falhou' && (
        <div role="status" data-testid="aviso-copia-falhou" className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <p>A cópia de prova de uma ou mais imagens falhou. A imagem original pode já não existir; a prova pode estar incompleta.</p>
        </div>
      )}

      {haImagensComUrl && urlsExpirados && (
        <div role="status" data-testid="aviso-urls-expirados" className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted p-2 text-xs">
          <p className="min-w-0 flex-1">Os links das imagens de prova expiram ao fim de 5 minutos e podem já não funcionar.</p>
          <Button size="sm" variant="outline" className="h-8" data-testid="recarregar-detalhe" disabled={aRecarregar} onClick={onRecarregar}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> {aRecarregar ? 'A recarregar…' : 'Recarregar o detalhe'}
          </Button>
        </div>
      )}

      {mensagens.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground" data-testid="excerto-vazio">O excerto não tem mensagens.</p>
      ) : (
        <ol aria-label="Excerto congelado da conversa" tabIndex={0} data-testid="excerto-lista"
          className="max-h-[360px] space-y-2 overflow-y-auto rounded-md border p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {mensagens.map((m) => {
            const denunc = m.papel === 'denunciado';
            return (
              <li key={m.id} data-testid="excerto-msg" data-papel={m.papel} data-principal={m.principal ? '1' : undefined}
                aria-label={m.principal ? 'Mensagem denunciada' : undefined}
                className={`rounded-md border p-2 text-sm ${m.principal ? 'border-primary bg-primary/10 ring-2 ring-primary' : 'border-border bg-card'}`}>
                <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs">
                  <span className={`rounded px-1.5 py-0.5 font-semibold ${denunc ? 'bg-destructive/15 text-foreground' : 'bg-secondary text-secondary-foreground'}`} data-testid="excerto-papel">
                    {denunc ? 'Denunciado' : 'Denunciante'}
                  </span>
                  <span className="text-muted-foreground">{nome(m)}</span>
                  <time className="text-muted-foreground" dateTime={m.criadoEm}>{hora(m.criadoEm)}</time>
                  {m.principal && <span className="inline-flex items-center gap-1 rounded border border-primary bg-background px-1.5 py-0.5 font-semibold text-foreground" data-testid="excerto-denunciada"><Flag className="h-3 w-3" aria-hidden="true" /> Mensagem denunciada</span>}
                  {m.retirada && <span className="rounded border border-destructive px-1.5 py-0.5 font-semibold text-foreground" data-testid="excerto-retirada">Retirada</span>}
                </div>

                {m.tipo === 'gorjeta' && m.gorjeta && (
                  <div className="mb-1 flex items-center gap-2 rounded border border-border bg-muted p-2" data-testid="excerto-gorjeta">
                    <Coins className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <p className="min-w-0 text-xs">Gorjeta de <strong>{kz(m.gorjeta.valor)}</strong> · comissão {kz(m.gorjeta.comissao)} · compra #{m.gorjeta.purchaseId ?? '—'}</p>
                  </div>
                )}

                {m.tipo === 'imagem' && m.imagem && (
                  m.imagem.provaUrl ? (
                    <button type="button" data-testid="excerto-imagem" aria-label={`Ampliar imagem enviada por ${nome(m)}`}
                      onClick={() => setAmpliada({ url: m.imagem!.provaUrl as string, autor: nome(m) })}
                      className="mb-1 block overflow-hidden rounded border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <img key={carregadoEm} src={m.imagem.provaUrl} alt={`Imagem enviada por ${nome(m)} (cópia de prova)`} draggable={false} onError={() => setImgComErro(true)} className="h-24 w-24 object-cover" />
                    </button>
                  ) : (
                    <p className="mb-1 flex items-center gap-2 rounded border border-dashed p-2 text-xs text-muted-foreground" data-testid="excerto-imagem-indisponivel">
                      <ImageOff className="h-4 w-4 shrink-0" aria-hidden="true" />
                      {m.imagem.copiaEstado === 'falhou' ? 'A cópia de prova desta imagem falhou: a imagem original pode já não existir.' : 'Imagem de prova indisponível.'}
                    </p>
                  )
                )}

                {m.conteudo ? <p className="whitespace-pre-wrap break-words">{m.conteudo}</p> : (m.tipo === 'texto' && <p className="text-xs italic text-muted-foreground">(sem texto)</p>)}
              </li>
            );
          })}
        </ol>
      )}

      <Dialog open={!!ampliada} onOpenChange={(o) => { if (!o) setAmpliada(null); }}>
        <DialogContent className="max-w-[92vw] sm:max-w-3xl" data-testid="imagem-ampliada">
          <DialogHeader>
            <DialogTitle>Imagem de prova</DialogTitle>
            <DialogDescription>Cópia congelada da imagem enviada por {ampliada?.autor}. Só para análise.</DialogDescription>
          </DialogHeader>
          {ampliada && <img src={ampliada.url} alt={`Imagem enviada por ${ampliada.autor} (cópia de prova, ampliada)`} draggable={false} onContextMenu={(e) => e.preventDefault()} onError={() => setImgComErro(true)} className="mx-auto max-h-[70vh] w-auto max-w-full rounded object-contain" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}


export interface RetiradaDaMensagem {
  retirada: boolean; retiradaEm: string | null; retiradoPor: string | null; retiradoMotivo: string | null; retiradaAuto: boolean;
  podeRepor: boolean; impedimento: string | null;
}

const MOTIVO_MIN = 5, MOTIVO_MAX = 300;

/**
 * Estado da mensagem denunciada (visível ou retirada, quem, quando, porquê) e a reposição: «Repor mensagem» só se o servidor disser que se
 * pode (podeRepor); senão mostra o impedimento. A reposição pede sempre um motivo e fica registada no audit; a denúncia mantém o estado.
 */
export function EstadoMensagem({ retirada, aRepor, erro, onRepor, onLimparErro }: {
  retirada: RetiradaDaMensagem | null | undefined; aRepor: boolean; erro: string | null; onRepor: (motivo: string) => Promise<boolean>; onLimparErro: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState('');
  if (!retirada) return null;
  const valido = motivo.trim().length >= MOTIVO_MIN && motivo.trim().length <= MOTIVO_MAX;
  const fechar = () => { if (aRepor) return; setAberto(false); setMotivo(''); onLimparErro(); };

  return (
    <section aria-labelledby="estado-mensagem-titulo" className="space-y-2 rounded-md border p-3" data-testid="estado-mensagem">
      <h3 id="estado-mensagem-titulo" className="text-xs uppercase text-muted-foreground">Estado da mensagem</h3>
      {retirada.retirada ? (
        <div className="space-y-1 text-sm">
          <p><span className="rounded border border-destructive px-1.5 py-0.5 text-xs font-semibold" data-testid="estado-retirada">Retirada</span>{' '}
            {retirada.retiradaAuto ? 'automaticamente (denúncia de menor)' : retirada.retiradoPor ? <>por <strong>{retirada.retiradoPor}</strong></> : null}
            {retirada.retiradaEm ? <> em {hora(retirada.retiradaEm)}</> : null}
          </p>
          {retirada.retiradoMotivo && <p className="break-words text-muted-foreground">Motivo: {retirada.retiradoMotivo}</p>}
          {retirada.podeRepor ? (
            <Button size="sm" variant="outline" className="min-h-[44px] sm:min-h-8" data-testid="repor-abrir" onClick={() => setAberto(true)}>Repor mensagem</Button>
          ) : retirada.impedimento && (
            <p role="note" className="rounded-md border border-border bg-muted p-2 text-xs" data-testid="repor-impedimento">Não pode ser reposta: {retirada.impedimento}</p>
          )}
        </div>
      ) : (
        <p className="text-sm" data-testid="estado-visivel"><span className="rounded border border-border px-1.5 py-0.5 text-xs font-semibold">Visível</span> A mensagem está visível para os dois participantes.</p>
      )}

      <Dialog open={aberto} onOpenChange={(o) => { if (!o) fechar(); }}>
        <DialogContent className="sm:max-w-[480px]" data-testid="repor-dialogo">
          <DialogHeader>
            <DialogTitle>Repor mensagem</DialogTitle>
            <DialogDescription>A mensagem volta a aparecer normalmente para os dois participantes. A denúncia mantém a decisão, a prova continua congelada e a reposição fica registada na auditoria.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label htmlFor="repor-motivo" className="text-sm font-medium">Motivo da reposição (obrigatório)</label>
            <Textarea id="repor-motivo" data-testid="repor-motivo" rows={3} maxLength={MOTIVO_MAX} value={motivo} aria-describedby="repor-motivo-ajuda" aria-invalid={!!erro} onChange={(e) => { setMotivo(e.target.value); if (erro) onLimparErro(); }} />
            <p id="repor-motivo-ajuda" className="text-xs text-muted-foreground">{motivo.trim().length}/{MOTIVO_MAX} · mínimo {MOTIVO_MIN} caracteres</p>
            {erro && <p role="alert" className="text-xs text-destructive" data-testid="repor-erro">{erro}</p>}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={fechar} disabled={aRepor}>Cancelar</Button>
            <Button data-testid="repor-confirmar" disabled={!valido || aRepor} onClick={async () => { if (await onRepor(motivo.trim())) { setAberto(false); setMotivo(''); } }}>{aRepor ? 'A repor…' : 'Repor mensagem'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
