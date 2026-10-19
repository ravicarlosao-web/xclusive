import { getFreshAuthToken } from '@workspace/api-client-react';

/** Estado efetivo calculado pelo servidor (GET /subscriptions/me). */
export type SubEstado = 'ativa' | 'cancelada' | 'expirada';

export interface MinhaSubscricao {
  id: number;
  estado: SubEstado;
  temAcesso: boolean;
  gratuita: boolean;
  inicioEm: string;
  /** Fim do período atual (é o `periodoAtual` a enviar em /renovar). null = gratuita. */
  renovacaoEm: string | null;
  acessoAte: string | null;
  terminouEm: string | null;
  /** Preço ATUAL do plano (o que a renovação vai cobrar). */
  preco: number | null;
  plano: { id: number; nome: string } | null;
  podeRenovar: boolean;
  criador: {
    id: number;
    username: string;
    nomeExibicao: string | null;
    avatarUrl: string | null;
    verificado: boolean;
    tipoSubscricao: 'gratuita' | 'paga';
  };
}

/** Plano atual de um criador (GET /users/:username/subscription-plan). */
export interface PlanoCriador {
  id: number | null;
  criadorId: number;
  tipoSubscricao: 'gratuita' | 'paga';
  nome: string | null;
  preco: number;
  beneficios: string | null;
}

export const MINHAS_SUBS_KEY = ['/api/subscriptions/me'] as const;

/** Erro com a mensagem do servidor e o código HTTP (402 saldo, 409 conflito, …). */
export class SubscricaoError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'SubscricaoError';
    this.status = status;
  }
}

/** Sessão de demonstração (modo mock): estas funções novas só existem com a API real. */
export function ehSessaoMock(): boolean {
  if (!import.meta.env.DEV) return false; // produção: não há sessão mock
  try { return (localStorage.getItem('xclusive_token') ?? '').startsWith('mock_token_'); } catch { return false; }
}

/** fetch autenticado à API; lança SubscricaoError com a mensagem do servidor. */
export async function apiSub<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
  const token = await getFreshAuthToken();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new SubscricaoError('Sem ligação ao servidor. Tenta novamente.', 0);
  }
  const body = await res.json().catch(() => null) as (T & { error?: string }) | null;
  if (!res.ok) throw new SubscricaoError(body?.error || 'Não foi possível concluir o pedido.', res.status);
  return body as T;
}

export const fetchMinhasSubscricoes = async (): Promise<MinhaSubscricao[]> =>
  (await apiSub<{ subscricoes: MinhaSubscricao[] }>('/api/subscriptions/me')).subscricoes;

export const fetchPlanoCriador = (username: string): Promise<PlanoCriador> =>
  apiSub<PlanoCriador>(`/api/users/${encodeURIComponent(username)}/subscription-plan`);

export const formatarData = (iso: string): string =>
  new Date(iso).toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', year: 'numeric' });

export const kz = (n: number): string => `${n.toLocaleString('pt-PT')} Kz`;
