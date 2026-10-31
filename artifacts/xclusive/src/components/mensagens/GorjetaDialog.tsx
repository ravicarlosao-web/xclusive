import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSendMessageTip, getGetMessagesQueryKey } from '@workspace/api-client-react';
import { Coins, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { TopUpModal } from '@/components/wallet/TopUpModal';
import { cn } from '@/lib/utils';

/** Limites do backend (lib/gorjetaMensagem.ts). */
const MIN_KZ = 50;
const MAX_KZ = 100_000;
const MENSAGEM_MAX = 255;
const PRESETS = [50, 100, 200, 500, 1000, 2000];

const kz = (v: number) => v.toLocaleString('pt-PT');
const novaChave = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`);

interface Erro { texto: string; semSaldo?: boolean }

/** Texto (pt-PT) de cada recusa do servidor; devolve também se a chave deve mudar. */
function interpretar(e: unknown, saldo: number | null): Erro & { novaChave?: boolean; recarregar?: boolean } {
  const st = (e as { status?: number } | null)?.status;
  const d = (e as { data?: { error?: string; codigo?: string } } | null)?.data;
  const codigo = d?.codigo;
  const servidor = typeof d?.error === 'string' && d.error ? d.error : null;
  if (st === 402 || codigo === 'saldo_insuficiente') return { texto: saldo !== null ? `Saldo insuficiente — tens ${kz(saldo)} Kz.` : 'Saldo insuficiente.', semSaldo: true };
  if (st === 429 && codigo === 'limite_diario') return { texto: 'Atingiste o limite diário de gorjetas.' };
  if (st === 429) return { texto: servidor ?? 'Demasiadas gorjetas num curto espaço de tempo. Tenta novamente dentro de 1 minuto.' };
  if (st === 403 && codigo === 'destinatario_invalido') return { texto: 'Este criador ainda não pode receber gorjetas.', recarregar: true };
  if (st === 403 && (codigo === 'bloqueaste' || codigo === 'mensagens_restritas' || codigo === 'conta_nao_permitida')) return { texto: servidor ?? 'Não podes enviar gorjetas nesta conversa.', recarregar: true };
  if (st === 404) return { texto: 'Conversa indisponível.', recarregar: true };
  if (st === 409 && codigo === 'chave_reutilizada') return { texto: 'Houve um conflito com o pedido anterior. Tenta novamente.', novaChave: true };
  if (st === 400 && servidor) return { texto: servidor };
  return { texto: 'Não foi possível enviar a gorjeta. Tenta novamente.' };
}

/**
 * Gorjeta dentro de uma conversa com um criador. POST /conversations/:id/gorjeta com chave de idempotência: a chave é criada ao abrir,
 * REUTILIZADA em "Tentar novamente" e só muda depois de sucesso, de um 409, ou quando o utilizador muda o valor ou a mensagem.
 * (O diálogo das gorjetas de posts, TipModal, não é tocado.)
 */
export function GorjetaDialog({ aberto, onFechar, convId, criador }: {
  aberto: boolean; onFechar: () => void; convId: number;
  criador: { username: string; nomeExibicao?: string | null };
}) {
  const { saldo, refreshSaldo } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const enviar = useSendMessageTip();

  const [selecionado, setSelecionado] = useState<number | null>(null);
  const [livre, setLivre] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState<Erro | null>(null);
  const [aEnviar, setAEnviar] = useState(false);
  const [carteiraAberta, setCarteiraAberta] = useState(false);
  const chave = useRef(novaChave());
  const emCurso = useRef(false); // anti duplo clique síncrono (antes de o estado atualizar)

  useEffect(() => {
    if (aberto) { setSelecionado(null); setLivre(''); setMensagem(''); setErro(null); setAEnviar(false); chave.current = novaChave(); emCurso.current = false; }
  }, [aberto]);

  const livreTexto = livre.trim();
  const livreValido = livreTexto === '' || /^\d+$/.test(livreTexto);
  const valor: number | null = selecionado ?? (livreTexto !== '' && livreValido ? parseInt(livreTexto, 10) : null);
  const erroValor = !livreValido ? 'Insere um valor inteiro em Kz.'
    : valor !== null && valor < MIN_KZ ? `O valor mínimo é ${kz(MIN_KZ)} Kz.`
    : valor !== null && valor > MAX_KZ ? `O valor máximo é ${kz(MAX_KZ)} Kz.` : null;
  const semSaldo = saldo !== null && (saldo < MIN_KZ || (valor !== null && valor > saldo));
  const podeEnviar = valor !== null && erroValor === null && !semSaldo && !aEnviar;

  const mudou = () => { chave.current = novaChave(); setErro(null); };

  const invalidar = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetMessagesQueryKey(convId) }),
      queryClient.invalidateQueries({ queryKey: ['conversations'] }),
      queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && /^\/api\/(conversations|wallet|creator)/.test(q.queryKey[0]) }),
    ]);
    refreshSaldo(); // atualiza o saldo em todo o lado (menu lateral incluído)
  };

  const submeter = async () => {
    if (emCurso.current || !podeEnviar || valor === null) return;
    emCurso.current = true; setAEnviar(true); setErro(null);
    try {
      await enviar.mutateAsync({ id: convId, data: { valor, chave: chave.current, ...(mensagem.trim() ? { mensagem: mensagem.trim() } : {}) } });
      chave.current = novaChave();
      toast({ title: 'Gorjeta enviada' });
      void invalidar();
      onFechar();
    } catch (e) {
      const r = interpretar(e, saldo);
      if (r.novaChave) chave.current = novaChave();
      setErro({ texto: r.texto, semSaldo: r.semSaldo });
      if (r.recarregar || r.semSaldo) void invalidar();
    } finally {
      emCurso.current = false; setAEnviar(false);
    }
  };

  return (
    <>
      <Dialog open={aberto} onOpenChange={(o) => { if (!o && !aEnviar) onFechar(); }}>
        <DialogContent className="max-w-sm gap-4" data-testid="gorjeta-dialogo">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Coins className="h-5 w-5 text-primary" aria-hidden="true" /> Enviar gorjeta a @{criador.username}</DialogTitle>
            <DialogDescription>A gorjeta fica na conversa. O valor é debitado da tua carteira.</DialogDescription>
          </DialogHeader>

          <p className="rounded-full bg-secondary px-3 py-1.5 text-center text-sm" data-testid="gorjeta-saldo">
            Saldo: <span className="font-bold">{saldo !== null ? `${kz(saldo)} Kz` : '—'}</span>
          </p>

          <div role="group" aria-label="Valores rápidos" className="grid grid-cols-3 gap-2">
            {PRESETS.map((v) => (
              <button key={v} type="button" aria-pressed={selecionado === v} data-testid={`gorjeta-preset-${v}`} disabled={aEnviar}
                onClick={() => { setSelecionado(v); setLivre(''); mudou(); }}
                className={cn('min-h-[44px] rounded-xl border text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
                  selecionado === v ? 'border-primary bg-primary text-white' : 'border-border bg-secondary text-foreground hover:border-primary/50')}>
                {kz(v)} Kz
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="gorjeta-livre">Outro valor (Kz)</Label>
            <Input id="gorjeta-livre" data-testid="gorjeta-livre" inputMode="numeric" autoComplete="off" placeholder={`${MIN_KZ} a ${kz(MAX_KZ)}`} value={livre} disabled={aEnviar}
              aria-invalid={erroValor !== null} aria-describedby="gorjeta-valor-erro" className="min-h-[44px]"
              onChange={(e) => { setLivre(e.target.value); setSelecionado(null); mudou(); }} />
            <p id="gorjeta-valor-erro" role="alert" aria-live="polite" data-testid="gorjeta-valor-erro" className="min-h-[1rem] text-xs text-destructive">{erroValor ?? ''}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="gorjeta-mensagem">Mensagem (opcional)</Label>
            <Input id="gorjeta-mensagem" data-testid="gorjeta-mensagem" maxLength={MENSAGEM_MAX} autoComplete="off" placeholder="Escreve uma mensagem…" value={mensagem} disabled={aEnviar} className="min-h-[44px]"
              onChange={(e) => { setMensagem(e.target.value); mudou(); }} />
            <p className="text-right text-xs text-muted-foreground" data-testid="gorjeta-contador" aria-label={`${mensagem.length} de ${MENSAGEM_MAX} caracteres`}>{mensagem.length}/{MENSAGEM_MAX}</p>
          </div>

          {semSaldo && (
            <div role="alert" data-testid="gorjeta-sem-saldo" className="space-y-2 rounded-xl border border-border bg-secondary p-3 text-sm">
              <p>Saldo insuficiente — tens {saldo !== null ? kz(saldo) : 0} Kz.</p>
              <button type="button" data-testid="gorjeta-carregar" onClick={() => setCarteiraAberta(true)}
                className="inline-flex min-h-[44px] items-center rounded-full bg-primary px-4 text-sm font-bold text-white transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Carregar carteira</button>
            </div>
          )}

          <div aria-live="assertive" role="alert" data-testid="gorjeta-erro-area" className="empty:hidden">
            {erro && !(erro.semSaldo && semSaldo) && (
              <div data-testid="gorjeta-erro" className="space-y-2 rounded-xl border border-destructive/40 p-3 text-sm text-destructive">
                <p>{erro.texto}</p>
                <button type="button" data-testid="gorjeta-tentar" onClick={() => { void submeter(); }} disabled={aEnviar || !podeEnviar}
                  className="inline-flex min-h-[44px] items-center rounded-full border border-border bg-background px-4 font-semibold text-foreground transition-colors hover:bg-secondary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Tentar novamente</button>
              </div>
            )}
          </div>

          <button type="button" data-testid="gorjeta-enviar" onClick={() => { void submeter(); }} disabled={!podeEnviar}
            className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full bg-primary px-6 text-base font-bold text-white transition-colors hover:bg-primary/90 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {aEnviar ? <><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> A enviar…</> : valor !== null && erroValor === null ? `Enviar ${kz(valor)} Kz` : 'Enviar gorjeta'}
          </button>
        </DialogContent>
      </Dialog>
      <TopUpModal open={carteiraAberta} onClose={() => { setCarteiraAberta(false); refreshSaldo(); }} />
    </>
  );
}
