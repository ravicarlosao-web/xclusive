import { Coins } from 'lucide-react';

const kz = (v: number) => v.toLocaleString('pt-PT');

/** Cartão de gorjeta na bolha: valor, quem enviou/recebeu e a mensagem opcional. Nunca mostra comissão nem saldo. */
export function GorjetaCartao({ valor, mensagem, enviada }: { valor: number; mensagem?: string | null; enviada: boolean }) {
  return (
    <div data-testid="gorjeta-cartao" className="flex w-full max-w-[260px] min-w-[200px] flex-col gap-2 rounded-2xl border border-border bg-card p-3 text-foreground">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Coins className="h-5 w-5" /></span>
        <div className="min-w-0">
          <p className="text-sm font-bold leading-tight" data-testid="gorjeta-cartao-valor">Gorjeta de {kz(valor)} Kz</p>
          <p className="text-xs text-muted-foreground" data-testid="gorjeta-cartao-papel">{enviada ? 'Enviaste uma gorjeta' : 'Recebeste uma gorjeta'}</p>
        </div>
      </div>
      {mensagem && <p className="break-words rounded-lg bg-secondary px-3 py-2 text-sm" data-testid="gorjeta-cartao-mensagem">{mensagem}</p>}
    </div>
  );
}
