import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { adminApi } from '@/lib/api';
import { Scale } from 'lucide-react';

const MOTIVO_MIN = 10, MOTIVO_MAX = 500;
const kz = (n: number) => n.toLocaleString('pt-PT', { maximumFractionDigits: 2 });
/** Só o superadmin ajusta saldos (o servidor recusa os outros com 403; aqui o botão nem aparece). */
function sessaoAdmin(): { role?: string; id?: number } {
  try { return JSON.parse(localStorage.getItem('admin_user') ?? '{}') ?? {}; } catch { return {}; }
}
function novaChave(): string {
  try { return crypto.randomUUID(); } catch { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`; }
}

type Passo = 'form' | 'confirmar';

/**
 * Ajuste manual de saldo (crédito/débito) de uma conta, para o superadmin: formulário → passo de confirmação («saldo antes X → depois Y») → confirmar.
 * O pedido leva uma CHAVE por abertura do diálogo (o mesmo pedido repetido, p.ex. duplo clique ou nova tentativa, não ajusta duas vezes) e o saldo que foi mostrado na
 * confirmação (se mudou entretanto, o servidor recusa). Tudo fica registado (auditoria e «Ajustes de saldo»).
 */
export function AjustarSaldo({ userId, username, saldo, onFeito }: { userId: number; username: string; saldo: number; onFeito: () => void }) {
  const { toast } = useToast();
  const sessao = sessaoAdmin();
  const [aberto, setAberto] = useState(false);
  const [passo, setPasso] = useState<Passo>('form');
  const [tipo, setTipo] = useState<'credito' | 'debito'>('credito');
  const [valorTxt, setValorTxt] = useState('');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const chave = useRef<string>(novaChave());
  const emCurso = useRef(false);   // proteção contra duplo clique: um só envio de cada vez (além da chave no servidor)

  if (sessao.role !== 'superadmin' || sessao.id === userId) return null;

  const valorOk = /^\d+([.,]\d{1,2})?$/.test(valorTxt.trim()) && Number(valorTxt.trim().replace(',', '.')) > 0 && Number(valorTxt.trim().replace(',', '.')) <= 1_000_000_000;
  const valor = valorOk ? Number(valorTxt.trim().replace(',', '.')) : 0;
  const delta = tipo === 'debito' ? -valor : valor;
  const depois = Math.round(saldo * 100 + Math.round(delta * 100)) / 100;
  const motivoLimpo = motivo.trim();
  const motivoOk = motivoLimpo.length >= MOTIVO_MIN && motivoLimpo.length <= MOTIVO_MAX;
  const insuficiente = valorOk && depois < 0;
  const podeContinuar = valorOk && motivoOk && !insuficiente;

  const abrir = () => { chave.current = novaChave(); setPasso('form'); setTipo('credito'); setValorTxt(''); setMotivo(''); setErro(''); setAberto(true); };
  const fechar = () => { if (!enviando) setAberto(false); };

  async function confirmar() {
    if (emCurso.current || !podeContinuar) return;
    emCurso.current = true; setEnviando(true); setErro('');
    try {
      const r = await adminApi.adjustBalance(userId, { valor: delta, motivo: motivoLimpo, chave: chave.current, saldoEsperado: saldo });
      setAberto(false);
      toast({ title: r?.repetido ? 'Ajuste já registado' : tipo === 'debito' ? 'Débito registado' : 'Crédito registado', description: `Saldo de @${username}: ${kz(Number(r?.novoSaldo ?? depois))} Kz.` });
      onFeito();
    } catch (e) {
      const err = e as Error & { codigo?: string };
      setErro(err.message || 'Não foi possível registar o ajuste.');
      if (err.codigo === 'saldo_mudou') { setPasso('form'); onFeito(); }   // o saldo mudou: volta ao formulário com o saldo atualizado
    } finally {
      emCurso.current = false; setEnviando(false);
    }
  }

  return (
    <>
      <Button variant="outline" data-testid="ajustar-saldo-btn" onClick={abrir}>
        <Scale className="mr-2 h-4 w-4" /> Ajustar saldo
      </Button>
      <Dialog open={aberto} onOpenChange={(o) => { if (!o) fechar(); }}>
        <DialogContent data-testid="ajuste-dialogo">
          <DialogHeader>
            <DialogTitle>Ajustar saldo de @{username}</DialogTitle>
            <DialogDescription>
              Saldo atual: <strong data-testid="ajuste-saldo-atual">{kz(saldo)} Kz</strong>. O ajuste fica registado na auditoria e no histórico de ajustes da conta.
            </DialogDescription>
          </DialogHeader>

          {passo === 'form' ? (
            <div className="space-y-4">
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Tipo de ajuste</legend>
                <div role="radiogroup" aria-label="Tipo de ajuste" className="grid grid-cols-2 gap-2">
                  {([['credito', 'Crédito (soma ao saldo)'], ['debito', 'Débito (tira do saldo)']] as const).map(([v, rotulo]) => (
                    <button
                      key={v} type="button" role="radio" aria-checked={tipo === v} data-testid={`ajuste-tipo-${v}`}
                      onClick={() => setTipo(v)}
                      className={`rounded-md border px-3 py-2 text-sm text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tipo === v ? 'border-primary bg-primary/10 text-foreground font-semibold' : 'border-border bg-card text-muted-foreground hover:bg-secondary'}`}
                    >{rotulo}</button>
                  ))}
                </div>
              </fieldset>
              <div className="space-y-2">
                <Label htmlFor="ajuste-valor">Valor (Kz)</Label>
                <Input id="ajuste-valor" data-testid="ajuste-valor" inputMode="decimal" autoComplete="off" placeholder="Ex.: 5000" value={valorTxt} onChange={(e) => setValorTxt(e.target.value)} aria-invalid={valorTxt !== '' && !valorOk} />
                {valorTxt !== '' && !valorOk && <p className="text-xs text-destructive">Indica um valor positivo, com no máximo 2 casas decimais.</p>}
                {insuficiente && <p className="text-xs text-destructive" data-testid="ajuste-insuficiente">Saldo insuficiente para este débito (saldo atual: {kz(saldo)} Kz).</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="ajuste-motivo">Motivo (obrigatório, {MOTIVO_MIN} a {MOTIVO_MAX} caracteres; fica registado)</Label>
                <Textarea id="ajuste-motivo" data-testid="ajuste-motivo" rows={3} maxLength={MOTIVO_MAX} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                <p className="text-xs text-muted-foreground" data-testid="ajuste-motivo-contagem">{motivoLimpo.length}/{MOTIVO_MAX}{motivoLimpo.length > 0 && motivoLimpo.length < MOTIVO_MIN ? ` (mínimo ${MOTIVO_MIN})` : ''}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3" data-testid="ajuste-confirmacao-bloco">
              <p className="rounded-md border border-border bg-muted/40 p-3 text-sm" data-testid="ajuste-confirmacao">
                @{username}: saldo antes {kz(saldo)} Kz → depois {kz(depois)} Kz
              </p>
              <p className="text-sm text-muted-foreground">
                {tipo === 'debito' ? 'Débito' : 'Crédito'} de <strong className="text-foreground">{kz(valor)} Kz</strong>. Motivo: <span className="text-foreground">{motivoLimpo}</span>
              </p>
              <p className="text-xs text-muted-foreground">Confirma só se está certo: o ajuste fica registado e não se apaga (corrige-se com outro ajuste).</p>
            </div>
          )}

          {erro && <p role="alert" data-testid="ajuste-erro" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{erro}</p>}

          <DialogFooter>
            {passo === 'form' ? (
              <>
                <Button variant="outline" onClick={fechar} data-testid="ajuste-cancelar">Cancelar</Button>
                <Button data-testid="ajuste-continuar" disabled={!podeContinuar} onClick={() => { setErro(''); setPasso('confirmar'); }}>Continuar</Button>
              </>
            ) : (
              <>
                <Button variant="outline" data-testid="ajuste-voltar" disabled={enviando} onClick={() => { setErro(''); setPasso('form'); }}>Voltar</Button>
                <Button data-testid="ajuste-confirmar" disabled={enviando} onClick={() => void confirmar()}>
                  {enviando ? 'A registar…' : tipo === 'debito' ? `Confirmar débito de ${kz(valor)} Kz` : `Confirmar crédito de ${kz(valor)} Kz`}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
