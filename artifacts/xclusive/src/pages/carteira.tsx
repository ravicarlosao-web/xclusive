import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth, MockTransaction } from '@/contexts/AuthContext';
import { TopUpModal } from '@/components/wallet/TopUpModal';
import {
  Wallet, Plus, ArrowUpRight, ArrowDownLeft, Unlock,
  Sparkles, Coins, TrendingDown, Clock, RefreshCw, ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface ApiTransaction {
  id: string;
  tipo: string;
  amount: number;
  descricao?: string;
  criadoEm: string;
  credit: boolean;
  pendente?: boolean;
  status?: string;
  reference?: string;
}

type DisplayTx = {
  id: string;
  tipo: string;
  amount: number;
  descricao?: string;
  criadoEm: string;
  credit: boolean;
  pendente?: boolean;
};

// ─── Metadata por tipo ────────────────────────────────────────────────────────

const TX_META: Record<string, { icon: React.FC<any>; color: string; label: string }> = {
  carregamento: { icon: ArrowDownLeft, color: 'text-green-400',  label: 'Carregamento'  },
  gorjeta:      { icon: Coins,         color: 'text-yellow-400', label: 'Gorjeta'        },
  ppv:          { icon: Unlock,        color: 'text-amber-400',  label: 'Desbloqueio'   },
  subscricao:   { icon: Sparkles,      color: 'text-primary',    label: 'Subscrição'    },
  levantamento: { icon: TrendingDown,  color: 'text-blue-400',   label: 'Levantamento'  },
};

// ─── Hook para transações reais ───────────────────────────────────────────────

function useWalletTransactions(enabled: boolean) {
  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
  const token = localStorage.getItem('xclusive_token');

  return useQuery<ApiTransaction[]>({
    queryKey: ['/api/wallet/transactions'],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await fetch(`${base}/api/wallet/transactions?limit=50`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error('Erro ao carregar transações');
      const data = await res.json();
      return data.transactions ?? [];
    },
  });
}

// ─── Componente de linha de transação ─────────────────────────────────────────

function TxRow({ tx }: { tx: DisplayTx }) {
  const meta = TX_META[tx.tipo] ?? { icon: Coins, color: 'text-foreground', label: tx.tipo };
  const Icon = meta.icon;

  return (
    <div className="flex items-center justify-between px-4 py-3.5">
      <div className="flex items-center gap-3 min-w-0">
        <div className={cn(
          'w-9 h-9 rounded-full flex items-center justify-center bg-secondary shrink-0 relative',
          meta.color,
        )}>
          <Icon className="w-4 h-4" />
          {tx.pendente && (
            <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-yellow-500 border border-card" />
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold truncate">{meta.label}</p>
            {tx.pendente && (
              <span className="text-[10px] font-bold text-yellow-400 bg-yellow-500/15 px-1.5 py-0.5 rounded-full shrink-0">
                PENDENTE
              </span>
            )}
          </div>
          {tx.descricao && (
            <p className="text-xs text-muted-foreground truncate">{tx.descricao}</p>
          )}
          <p className="text-[10px] text-muted-foreground/60">
            {new Date(tx.criadoEm).toLocaleDateString('pt-PT', {
              day: 'numeric', month: 'short', year: 'numeric',
              hour: '2-digit', minute: '2-digit',
            })}
          </p>
        </div>
      </div>
      <div className={cn(
        'text-sm font-bold shrink-0 ml-2',
        tx.pendente
          ? 'text-yellow-400/70'
          : tx.credit
          ? 'text-green-400'
          : 'text-foreground',
      )}>
        {tx.credit || tx.pendente ? '+' : '-'}{tx.amount.toLocaleString('pt-PT')} Kz
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function Carteira() {
  const { saldo, user, isMockMode, getTransactionHistory, refreshSaldo } = useAuth();
  const [topUpOpen, setTopUpOpen] = useState(false);

  const isMockToken = (localStorage.getItem('xclusive_token') ?? '').startsWith('mock_token_');
  const useRealApi = !isMockToken && !!user;

  // Transações reais (modo API)
  const { data: apiTxs, isLoading: txLoading, refetch } = useWalletTransactions(useRealApi);

  // Transações mock (modo offline / mock)
  const mockTxs: DisplayTx[] = getTransactionHistory().map((tx: MockTransaction) => ({
    id: String(tx.id),
    tipo: tx.tipo,
    amount: tx.amount,
    descricao: tx.descricao || (tx.tipo !== 'carregamento' ? `@${tx.toUsername}` : undefined),
    criadoEm: tx.criadoEm,
    credit: tx.tipo === 'carregamento',
  }));

  const displayTxs: DisplayTx[] = useRealApi
    ? (apiTxs ?? []).map((t) => ({
        id: t.id,
        tipo: t.tipo,
        amount: t.amount,
        descricao: t.descricao,
        criadoEm: t.criadoEm,
        credit: t.credit,
        pendente: t.pendente,
      }))
    : mockTxs;

  const handleTopUpClose = () => {
    setTopUpOpen(false);
    // Refresh balance & transactions after top-up submission
    refreshSaldo();
    if (useRealApi) refetch();
  };

  return (
    <div className="w-full max-w-2xl mx-auto p-4 sm:p-8 pb-24">
      <h1 className="text-3xl font-extrabold tracking-tight mb-6">Carteira</h1>

      {/* ── Cartão de saldo ─────────────────────────────────────────────────── */}
      <div className="relative bg-gradient-to-br from-yellow-500/20 via-yellow-500/10 to-transparent border border-yellow-500/30 rounded-2xl p-6 mb-8 overflow-hidden">
        <div className="absolute top-0 right-0 w-48 h-48 bg-yellow-500/5 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-yellow-500/5 rounded-full translate-y-1/2 -translate-x-1/2" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-1">
            <Wallet className="w-5 h-5 text-yellow-500" />
            <span className="text-sm text-muted-foreground font-medium uppercase tracking-wide">
              Saldo disponível
            </span>
          </div>
          <div className="text-4xl font-extrabold tracking-tight mb-4">
            {saldo !== null
              ? saldo.toLocaleString('pt-PT')
              : <span className="text-muted-foreground">—</span>}
            {' '}
            <span className="text-2xl text-yellow-500 font-bold">Kz</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setTopUpOpen(true)}
              className="bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded-xl h-11 px-6 shadow-[0_0_20px_rgba(234,179,8,0.3)]"
            >
              <Plus className="w-4 h-4 mr-2" />
              Carregar Carteira
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => { refreshSaldo(); if (useRealApi) refetch(); }}
              className="h-11 w-11 rounded-xl border-yellow-500/30 hover:border-yellow-500/60"
              title="Atualizar saldo"
            >
              <RefreshCw className="w-4 h-4 text-yellow-500" />
            </Button>
          </div>
        </div>
      </div>

      {/* ── Como funciona ───────────────────────────────────────────────────── */}
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

      {/* ── Histórico de transações ─────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">Histórico de transações</h2>
          {displayTxs.some((t) => t.pendente) && (
            <div className="flex items-center gap-1.5 text-xs text-yellow-400">
              <Clock className="w-3.5 h-3.5" />
              <span>Carregamentos a aguardar aprovação</span>
            </div>
          )}
        </div>

        {txLoading ? (
          <div className="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                <div className="w-9 h-9 rounded-full bg-secondary animate-pulse shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 bg-secondary rounded animate-pulse w-32" />
                  <div className="h-2.5 bg-secondary rounded animate-pulse w-24" />
                </div>
                <div className="h-3 bg-secondary rounded animate-pulse w-16" />
              </div>
            ))}
          </div>
        ) : displayTxs.length === 0 ? (
          <div className="bg-card border border-border rounded-xl p-10 flex flex-col items-center text-center text-muted-foreground">
            <Wallet className="w-10 h-10 mb-3 opacity-30" />
            <p className="font-medium mb-1">Sem transações ainda</p>
            <p className="text-sm mb-4">Carrega a tua carteira para começar a usar a plataforma.</p>
            <Button
              onClick={() => setTopUpOpen(true)}
              className="bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded-xl h-10 px-5"
            >
              <Plus className="w-4 h-4 mr-2" />
              Carregar agora
            </Button>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl overflow-hidden divide-y divide-border">
            {displayTxs.map((tx) => (
              <TxRow key={tx.id} tx={tx} />
            ))}
          </div>
        )}

        {/* Nota sobre carregamentos pendentes */}
        {!txLoading && displayTxs.some((t) => t.pendente) && (
          <div className="mt-4 flex items-start gap-2 bg-yellow-500/8 border border-yellow-500/20 rounded-xl p-3">
            <Clock className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
            <p className="text-xs text-yellow-200/80">
              Os carregamentos pendentes serão aprovados pela nossa equipa em alguns minutos a horas úteis.
              O saldo é creditado automaticamente após aprovação.
            </p>
          </div>
        )}
      </div>

      <TopUpModal open={topUpOpen} onClose={handleTopUpClose} />
    </div>
  );
}
