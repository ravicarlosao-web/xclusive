import { useState } from 'react';
import { useAuth, MockTransaction } from '@/contexts/AuthContext';
import { TopUpModal } from '@/components/wallet/TopUpModal';
import { Wallet, Plus, ArrowUpRight, ArrowDownLeft, Unlock, Sparkles, Coins, TrendingDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const TX_ICONS: Record<string, { icon: React.FC<any>; color: string; label: string }> = {
  carregamento:  { icon: ArrowDownLeft, color: 'text-green-400',  label: 'Carregamento'  },
  gorjeta:       { icon: Coins,         color: 'text-yellow-400', label: 'Gorjeta'        },
  desbloqueio:   { icon: Unlock,        color: 'text-amber-400',  label: 'Desbloqueio'   },
  subscricao:    { icon: Sparkles,      color: 'text-primary',    label: 'Subscrição'    },
  levantamento:  { icon: TrendingDown,  color: 'text-blue-400',   label: 'Levantamento'  },
};

function isCredit(tx: MockTransaction, myUserId: number): boolean {
  return tx.tipo === 'carregamento';
}

export default function Carteira() {
  const { saldo, user, getTransactionHistory } = useAuth();
  const [topUpOpen, setTopUpOpen] = useState(false);

  const history = getTransactionHistory();

  return (
    <div className="w-full max-w-2xl mx-auto p-4 sm:p-8 pb-24">
      <h1 className="text-3xl font-extrabold tracking-tight mb-6">Carteira</h1>

      {/* Balance Card */}
      <div className="relative bg-gradient-to-br from-yellow-500/20 via-yellow-500/10 to-transparent border border-yellow-500/30 rounded-2xl p-6 mb-8 overflow-hidden">
        <div className="absolute top-0 right-0 w-48 h-48 bg-yellow-500/5 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-yellow-500/5 rounded-full translate-y-1/2 -translate-x-1/2" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-1">
            <Wallet className="w-5 h-5 text-yellow-500" />
            <span className="text-sm text-muted-foreground font-medium uppercase tracking-wide">Saldo disponível</span>
          </div>
          <div className="text-4xl font-extrabold tracking-tight mb-4">
            {saldo !== null ? saldo.toLocaleString('pt-PT') : '—'} <span className="text-2xl text-yellow-500 font-bold">Kz</span>
          </div>
          <Button
            onClick={() => setTopUpOpen(true)}
            className="bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded-xl h-11 px-6 shadow-[0_0_20px_rgba(234,179,8,0.3)]"
          >
            <Plus className="w-4 h-4 mr-2" />
            Carregar Carteira
          </Button>
        </div>
      </div>

      {/* How it works */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <div className="w-10 h-10 rounded-full bg-yellow-500/15 flex items-center justify-center mx-auto mb-2">
            <ArrowDownLeft className="w-5 h-5 text-yellow-500" />
          </div>
          <h3 className="font-bold text-sm mb-1">Carrega</h3>
          <p className="text-xs text-muted-foreground">Transfere por TPA ou banco para a conta Xclusive</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center mx-auto mb-2">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <h3 className="font-bold text-sm mb-1">Subscreve</h3>
          <p className="text-xs text-muted-foreground">Paga planos mensais ou conteúdo exclusivo</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <div className="w-10 h-10 rounded-full bg-green-500/15 flex items-center justify-center mx-auto mb-2">
            <Unlock className="w-5 h-5 text-green-400" />
          </div>
          <h3 className="font-bold text-sm mb-1">Desfruta</h3>
          <p className="text-xs text-muted-foreground">Acede a conteúdo premium dos teus criadores favoritos</p>
        </div>
      </div>

      {/* Transaction History */}
      <div>
        <h2 className="text-lg font-bold mb-4">Histórico de transações</h2>

        {history.length === 0 ? (
          <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
            <Wallet className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium mb-1">Sem transações</p>
            <p className="text-sm">Carrega a tua carteira para começar.</p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl overflow-hidden divide-y divide-border">
            {history.map((tx) => {
              const meta = TX_ICONS[tx.tipo] ?? { icon: Coins, color: 'text-foreground', label: tx.tipo };
              const Icon = meta.icon;
              const credit = tx.tipo === 'carregamento';

              return (
                <div key={tx.id} className="flex items-center justify-between px-4 py-3.5">
                  <div className="flex items-center gap-3">
                    <div className={cn("w-9 h-9 rounded-full flex items-center justify-center bg-secondary shrink-0", meta.color)}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{meta.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {tx.descricao || (tx.tipo !== 'carregamento' ? `@${tx.toUsername}` : '')}
                      </p>
                      <p className="text-[10px] text-muted-foreground/60">
                        {new Date(tx.criadoEm).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                  <div className={cn("text-sm font-bold", credit ? 'text-green-400' : 'text-foreground')}>
                    {credit ? '+' : '-'}{tx.amount.toLocaleString('pt-PT')} Kz
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <TopUpModal open={topUpOpen} onClose={() => setTopUpOpen(false)} />
    </div>
  );
}
