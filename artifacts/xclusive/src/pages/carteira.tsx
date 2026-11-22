import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth, MockTransaction } from '@/contexts/AuthContext';
import { TopUpModal } from '@/components/wallet/TopUpModal';
import {
  Wallet, Plus, ArrowUpRight, ArrowDownLeft, Unlock,
  Sparkles, Coins, TrendingDown, Clock, RefreshCw, ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { lerLocal } from '@/lib/armazenamento';

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
  carregamento: { icon: ArrowDownLeft, color: 'text-green-700 dark:text-green-400',  label: 'Carregamento'  },
  gorjeta:      { icon: Coins,         color: 'text-foreground',    label: 'Gorjeta'        },
  ppv:          { icon: Unlock,        color: 'text-foreground',     label: 'Desbloqueio'   },
  subscricao:   { icon: Sparkles,      color: 'text-primary',    label: 'Subscrição'    },
  levantamento: { icon: TrendingDown,  color: 'text-muted-foreground', label: 'Levantamento'  },
  ajuste:       { icon: RefreshCw,     color: 'text-muted-foreground',                label: 'Ajuste de saldo' },
};

// ─── Hook para transações reais ───────────────────────────────────────────────

function useWalletTransactions(enabled: boolean) {
  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
  const token = lerLocal('xclusive_token');

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
            <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-primary border border-card" />
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold truncate">{meta.label}</p>
            {tx.pendente && (
              <span className="text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full shrink-0">
                PENDENTE
              </span>
            )}
          </div>
          {tx.descricao && (
            <p className="text-xs text-muted-foreground truncate">{tx.descricao}</p>
          )}
          <p className="text-[10px] text-muted-foreground">
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
          ? 'text-muted-foreground'
          : tx.credit
          ? 'text-green-700 dark:text-green-400'
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

  const isMockToken = import.meta.env.DEV && (lerLocal('xclusive_token') ?? '').startsWith('mock_token_');
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
    <div className="w-full max-w-6xl mx-auto p-4 sm:p-8 pb-24">
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight">Carteira</h1>
      </div>

      {/* ── Cartão de saldo (mesmo cartão do Painel do Criador) ─────────────── */}
      <Card className="mb-4 bg-card border-border" data-testid="cartao-saldo">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Wallet className="w-4 h-4 text-primary" />
            Saldo disponível
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-4xl font-extrabold tracking-tight mb-4">
            {saldo !== null
              ? saldo.toLocaleString('pt-PT')
              : <span className="text-muted-foreground">—</span>}
            {' '}
            <span className="text-2xl text-muted-foreground font-bold">Kz</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setTopUpOpen(true)}
              className="font-bold rounded-xl h-11 px-6"
            >
              <Plus className="w-4 h-4 mr-2" />
              Carregar Carteira
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => { refreshSaldo(); if (useRealApi) refetch(); }}
              className="h-11 w-11 rounded-xl"
              title="Atualizar saldo"
            >
              <RefreshCw className="w-4 h-4 text-muted-foreground" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Como funciona ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <Card className="bg-card border-border p-4 text-center">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-2">
            <ArrowDownLeft className="w-5 h-5 text-primary" />
          </div>
          <h3 className="font-bold text-sm mb-1">Carrega</h3>
          <p className="text-xs text-muted-foreground">Transfere por TPA ou banco para a conta Xclusive</p>
        </Card>
        <Card className="bg-card border-border p-4 text-center">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-2">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <h3 className="font-bold text-sm mb-1">Subscreve</h3>
          <p className="text-xs text-muted-foreground">Paga planos mensais ou conteúdo exclusivo</p>
        </Card>
        <Card className="bg-card border-border p-4 text-center">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-2">
            <Unlock className="w-5 h-5 text-primary" />
          </div>
          <h3 className="font-bold text-sm mb-1">Desfruta</h3>
          <p className="text-xs text-muted-foreground">Acede a conteúdo premium dos teus criadores favoritos</p>
        </Card>
      </div>

      {/* ── Histórico de transações ─────────────────────────────────────────── */}
      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Histórico de transações</CardTitle>
          {displayTxs.some((t) => t.pendente) && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="w-3.5 h-3.5" />
              <span>Carregamentos a aguardar aprovação</span>
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {txLoading ? (
            <div className="divide-y divide-border border-t border-border">
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
            <div className="border-t border-border p-10 flex flex-col items-center text-center text-muted-foreground">
              <Wallet className="w-10 h-10 mb-3 opacity-30" />
              <p className="font-medium mb-1">Sem transações ainda</p>
              <p className="text-sm mb-4">Carrega a tua carteira para começar a usar a plataforma.</p>
              <Button
                onClick={() => setTopUpOpen(true)}
                className="font-bold rounded-xl h-11 px-5"
              >
                <Plus className="w-4 h-4 mr-2" />
                Carregar agora
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-border border-t border-border">
              {displayTxs.map((tx) => (
                <TxRow key={tx.id} tx={tx} />
              ))}
            </div>
          )}

          {/* Nota sobre carregamentos pendentes */}
          {!txLoading && displayTxs.some((t) => t.pendente) && (
            <div className="m-4 flex items-start gap-2 bg-secondary border border-border rounded-xl p-3">
              <Clock className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                Os carregamentos pendentes serão aprovados pela nossa equipa em alguns minutos a horas úteis.
                O saldo é creditado automaticamente após aprovação.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <TopUpModal open={topUpOpen} onClose={handleTopUpClose} />
    </div>
  );
}
