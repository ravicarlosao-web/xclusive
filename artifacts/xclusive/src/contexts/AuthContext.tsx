import { createContext, useContext, ReactNode, useEffect, useState, useCallback } from 'react';
import { useLocation } from 'wouter';
import {
  UserProfile,
  LoginInput,
  RegisterInput,
  useGetMe,
  login as apiLogin,
  register as apiRegister,
  logout as apiLogout,
  setAuthTokenGetter,
  setTokenRefreshHandler,
  setOnTokenRefreshed,
  setOnSessionExpired,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

// Wire the API client to always send the stored JWT token
setAuthTokenGetter(() => localStorage.getItem('xclusive_token'));

/** Lê o campo `exp` de um JWT sem verificar a assinatura (payload é público). */
function parseTokenExp(token: string): number | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch { return null; }
}

// ─── Mock store helpers (DB-less mode) ───────────────────────────────────────
const MOCK_KEY = 'xclusive_mock_users';
const MOCK_SESSION_KEY = 'xclusive_mock_session';

/** IBAN da plataforma Xclusive para receber carregamentos */
export const XCLUSIVE_IBAN = 'AO06 0040 0000 1234 5678 9012 3';
export const XCLUSIVE_IBAN_RAW = 'AO06004000001234567890123';

export interface DadosBancarios {
  iban: string;
  nomeTitular: string;
  banco: string;
}

export interface SubscricaoAtiva {
  expira: string; // ISO date
  preco: number;
}

interface MockUser {
  id: number;
  nomeCompleto: string;
  username: string;
  email: string;
  /** ⚠️ DEV-ONLY mock store — stored in localStorage, not for production use */
  _devPassword: string;
  dataNascimento: string;
  tipoConta: 'pessoal' | 'criador';
  pais: string;
  telefone?: string;
  verificado: boolean;
  avatarUrl: string | null;
  capaUrl: string | null;
  bio: string | null;
  link: string | null;
  nomeExibicao: string;
  totalSeguidores: number;
  totalSeguindo: number;
  totalPublicacoes: number;
  /** Saldo em Kwanza (Kz) — carteira para gastos */
  saldo: number;
  /** Ganhos do criador — só disponíveis para levantamento no dia 29 */
  ganhos: number;
  /** Dados bancários do criador para levantamento */
  dadosBancarios?: DadosBancarios;
  /** Subscricoes ativas: chave = username do criador */
  subscricoes: Record<string, SubscricaoAtiva>;
  /** IDs de posts desbloqueados com pagamento único */
  conteudoDesbloqueado: number[];
  criadoEm: string;
}

export type TransactionTipo = 'gorjeta' | 'carregamento' | 'desbloqueio' | 'subscricao' | 'levantamento';

const MOCK_TRANSACTIONS_KEY = 'xclusive_mock_transactions';

// ─── Top-up requests (shared with admin via localStorage) ────────────────────
import { getTopUpRequests as _getTopUpRequests, saveTopUpRequests as _saveTopUpRequests } from '@/lib/topupStorage';
import type { TopUpRequest as _TopUpRequest } from '@/lib/topupStorage';
export interface MockTransaction {
  id: number;
  fromUserId: number;
  toUsername: string;
  amount: number;
  postId?: number;
  tipo: TransactionTipo;
  descricao?: string;
  criadoEm: string;
}
function getTransactions(): MockTransaction[] {
  try { return JSON.parse(localStorage.getItem(MOCK_TRANSACTIONS_KEY) || '[]'); } catch { return []; }
}
function saveTransactions(txs: MockTransaction[]) {
  localStorage.setItem(MOCK_TRANSACTIONS_KEY, JSON.stringify(txs));
}

/**
 * Obfusca dadosBancarios antes de guardar em localStorage.
 * ⚠️ NOTA: Base64 NÃO é encriptação — é apenas obfuscação para o sistema mock.
 * Em produção, dados bancários devem ser guardados exclusivamente no servidor,
 * encriptados em repouso com chave de servidor, e nunca transmitidos ao cliente.
 */
function encodeDadosBancarios(dados: DadosBancarios): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(dados))));
}
function decodeDadosBancarios(enc: string): DadosBancarios | null {
  try { return JSON.parse(decodeURIComponent(escape(atob(enc)))); } catch { return null; }
}

function getMockUsers(): MockUser[] {
  try {
    const raw = JSON.parse(localStorage.getItem(MOCK_KEY) || '[]') as Array<Record<string, unknown>>;
    return raw.map(u => {
      // Suporte a dados legados em plaintext: migra na leitura
      if (u._dadosBancariosEnc && typeof u._dadosBancariosEnc === 'string') {
        const { _dadosBancariosEnc, ...rest } = u;
        const dadosBancarios = decodeDadosBancarios(_dadosBancariosEnc);
        return dadosBancarios ? { ...rest, dadosBancarios } as unknown as MockUser : rest as unknown as MockUser;
      }
      // Migração de dados em plaintext deixados por versões anteriores
      if (u.dadosBancarios) {
        const enc = encodeDadosBancarios(u.dadosBancarios as DadosBancarios);
        const { dadosBancarios: _plain, ...rest } = u;
        void _plain;
        return { ...rest, dadosBancarios: decodeDadosBancarios(enc) } as unknown as MockUser;
      }
      return u as unknown as MockUser;
    });
  } catch { return []; }
}
function saveMockUsers(users: MockUser[]) {
  const serialized = users.map(u => {
    if (!u.dadosBancarios) return u;
    const { dadosBancarios, ...rest } = u;
    // Guarda dados bancários obfuscados — nunca em plaintext
    return { ...rest, _dadosBancariosEnc: encodeDadosBancarios(dadosBancarios) };
  });
  localStorage.setItem(MOCK_KEY, JSON.stringify(serialized));
}

// Pre-seed test accounts so they work even without a real DB
const SEED_USERS: MockUser[] = [
  { id: 1, nomeCompleto: 'Demo User', username: 'demo', email: 'demo@xclusive.pt', _devPassword: 'password123', dataNascimento: '1995-06-15', tipoConta: 'pessoal', pais: 'Angola', verificado: false, avatarUrl: 'https://i.pravatar.cc/150?img=12', capaUrl: null, bio: 'Utilizador de demonstração 👋', link: null, nomeExibicao: 'Demo User', totalSeguidores: 24, totalSeguindo: 61, totalPublicacoes: 0, saldo: 15000, ganhos: 0, subscricoes: {}, conteudoDesbloqueado: [], criadoEm: '2024-01-01T00:00:00.000Z' },
  { id: 2, nomeCompleto: 'Ana Costa', username: 'ana', email: 'ana@xclusive.pt', _devPassword: 'password123', dataNascimento: '1998-03-22', tipoConta: 'criador', pais: 'Angola', verificado: true, avatarUrl: 'https://i.pravatar.cc/150?img=47', capaUrl: null, bio: '📸 Fotografia & Lifestyle | Luanda 🇦🇴', link: 'https://xclusive.ao/ana', nomeExibicao: 'Ana Costa', totalSeguidores: 1248, totalSeguindo: 182, totalPublicacoes: 34, saldo: 12500, ganhos: 125000, subscricoes: {}, conteudoDesbloqueado: [], criadoEm: '2024-01-01T00:00:00.000Z' },
  { id: 3, nomeCompleto: 'Marcos Silva', username: 'marcos', email: 'marcos@xclusive.pt', _devPassword: 'password123', dataNascimento: '1996-09-10', tipoConta: 'criador', pais: 'Angola', verificado: true, avatarUrl: 'https://i.pravatar.cc/150?img=33', capaUrl: null, bio: '🎵 Músico | Produtor | Luanda', link: null, nomeExibicao: 'Marcos Silva', totalSeguidores: 3102, totalSeguindo: 95, totalPublicacoes: 57, saldo: 34800, ganhos: 345000, subscricoes: {}, conteudoDesbloqueado: [], criadoEm: '2024-01-01T00:00:00.000Z' },
  { id: 4, nomeCompleto: 'Sofia Mendes', username: 'sofia', email: 'sofia@xclusive.pt', _devPassword: 'password123', dataNascimento: '2000-12-05', tipoConta: 'criador', pais: 'Moçambique', verificado: false, avatarUrl: 'https://i.pravatar.cc/150?img=44', capaUrl: null, bio: '💄 Beleza & Moda | Maputo 🇲🇿', link: null, nomeExibicao: 'Sofia Mendes', totalSeguidores: 892, totalSeguindo: 312, totalPublicacoes: 22, saldo: 8200, ganhos: 67000, subscricoes: {}, conteudoDesbloqueado: [], criadoEm: '2024-01-01T00:00:00.000Z' },
  { id: 5, nomeCompleto: 'Pedro Alves', username: 'pedro', email: 'pedro@xclusive.pt', _devPassword: 'password123', dataNascimento: '1993-07-18', tipoConta: 'criador', pais: 'Angola', verificado: true, avatarUrl: 'https://i.pravatar.cc/150?img=60', capaUrl: null, bio: '🏋️ Fitness & Nutrição | Luanda', link: null, nomeExibicao: 'Pedro Alves', totalSeguidores: 5430, totalSeguindo: 47, totalPublicacoes: 89, saldo: 67300, ganhos: 892000, subscricoes: {}, conteudoDesbloqueado: [], dadosBancarios: { iban: 'AO06 0006 0000 5555 6666 7777 8', nomeTitular: 'Pedro Alves', banco: 'BAI - Banco Angolano de Investimentos' }, criadoEm: '2024-01-01T00:00:00.000Z' },
  { id: 6, nomeCompleto: 'Luna Ferreira', username: 'luna', email: 'luna@xclusive.pt', _devPassword: 'password123', dataNascimento: '2001-04-30', tipoConta: 'criador', pais: 'África do Sul', verificado: false, avatarUrl: 'https://i.pravatar.cc/150?img=56', capaUrl: null, bio: '🎨 Arte Digital | Cape Town 🇿🇦', link: null, nomeExibicao: 'Luna Ferreira', totalSeguidores: 421, totalSeguindo: 203, totalPublicacoes: 15, saldo: 3100, ganhos: 23000, subscricoes: {}, conteudoDesbloqueado: [], criadoEm: '2024-01-01T00:00:00.000Z' },
];

function seedMockUsersIfEmpty() {
  let existing = getMockUsers();
  let migrated = false;
  // Migrate: give missing fields to any user who doesn't have them yet
  existing = existing.map(u => {
    let changed = false;
    const updated = { ...u } as MockUser;
    if ((u as any).saldo === undefined) { updated.saldo = 5000; changed = true; }
    if ((u as any).ganhos === undefined) { updated.ganhos = 0; changed = true; }
    if ((u as any).subscricoes === undefined) { updated.subscricoes = {}; changed = true; }
    if ((u as any).conteudoDesbloqueado === undefined) { updated.conteudoDesbloqueado = []; changed = true; }
    if (changed) migrated = true;
    return updated;
  });
  // Merge: keep real registered users, add seeds only if email not already present
  const existingEmails = new Set(existing.map(u => u.email));
  const toAdd = SEED_USERS.filter(s => !existingEmails.has(s.email));
  if (toAdd.length > 0 || migrated) {
    saveMockUsers([...existing, ...toAdd]);
  }
}
function mockUserToProfile(u: MockUser): UserProfile {
  return {
    id: u.id,
    username: u.username,
    nomeExibicao: u.nomeExibicao,
    email: u.email,
    tipoConta: u.tipoConta,
    verificado: u.verificado,
    privado: false,
    avatarUrl: u.avatarUrl,
    capaUrl: u.capaUrl,
    bio: u.bio,
    link: u.link,
    totalSeguidores: u.totalSeguidores,
    totalSeguindo: u.totalSeguindo,
    totalPublicacoes: u.totalPublicacoes,
    estaASeguir: false,
    criadoEm: u.criadoEm,
  } as UserProfile;
}
function makeMockToken(userId: number): string {
  return `mock_token_${userId}_${Date.now()}`;
}

async function mockLogin(data: LoginInput): Promise<{ token: string; user: UserProfile }> {
  const users = getMockUsers();
  const user = users.find(u => u.email === data.email && u._devPassword === data.password);
  if (!user) throw new Error('Email ou password incorretos.');
  const token = makeMockToken(user.id);
  localStorage.setItem(MOCK_SESSION_KEY, JSON.stringify({ token, userId: user.id }));
  return { token, user: mockUserToProfile(user) };
}

async function mockRegister(data: RegisterInput & { pais?: string; telefone?: string; tipoConta?: string }): Promise<{ token: string; user: UserProfile }> {
  const users = getMockUsers();
  if (users.find(u => u.email === data.email)) throw new Error('Este email já está registado.');
  if (users.find(u => u.username === data.username)) throw new Error('Este username já está a ser usado.');
  const newUser: MockUser = {
    id: Date.now(),
    nomeCompleto: data.nomeCompleto,
    username: data.username,
    email: data.email,
    _devPassword: data.password,
    dataNascimento: data.dataNascimento,
    tipoConta: (data.tipoConta as 'pessoal' | 'criador') || 'pessoal',
    pais: data.pais || 'Angola',
    telefone: data.telefone,
    verificado: false,
    avatarUrl: null,
    capaUrl: null,
    bio: null,
    link: null,
    nomeExibicao: data.nomeCompleto,
    totalSeguidores: 0,
    totalSeguindo: 0,
    totalPublicacoes: 0,
    saldo: 1000, // bónus de boas-vindas
    ganhos: 0,
    subscricoes: {},
    conteudoDesbloqueado: [],
    criadoEm: new Date().toISOString(),
  };
  saveMockUsers([...users, newUser]);
  const token = makeMockToken(newUser.id);
  localStorage.setItem(MOCK_SESSION_KEY, JSON.stringify({ token, userId: newUser.id }));
  return { token, user: mockUserToProfile(newUser) };
}

async function mockLogout() {
  localStorage.removeItem(MOCK_SESSION_KEY);
}

function getMockSession(): UserProfile | null {
  try {
    const session = JSON.parse(localStorage.getItem(MOCK_SESSION_KEY) || 'null');
    if (!session) return null;
    const users = getMockUsers();
    const user = users.find(u => u.id === session.userId);
    return user ? mockUserToProfile(user) : null;
  } catch { return null; }
}

function getCurrentMockUser(): MockUser | null {
  try {
    const session = JSON.parse(localStorage.getItem(MOCK_SESSION_KEY) || 'null');
    if (!session) return null;
    const users = getMockUsers();
    return users.find(u => u.id === session.userId) ?? null;
  } catch { return null; }
}
// ─────────────────────────────────────────────────────────────────────────────

interface AuthContextType {
  user: UserProfile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isMockMode: boolean;
  /** Saldo da carteira em Kz (null se não autenticado ou modo API real) */
  saldo: number | null;
  /** Ganhos do criador em Kz */
  ganhos: number | null;
  login: (data: LoginInput) => Promise<void>;
  register: (data: RegisterInput & { pais?: string; telefone?: string; tipoConta?: string }) => Promise<void>;
  logout: () => Promise<void>;
  setToken: (token: string | null) => void;
  /** Update the current user's account type locally (mock + optimistic). Used by KYC flow. */
  updateTipoConta: (tipo: 'pessoal' | 'criador') => void;
  /** Envia gorjeta ao criador. Lança erro se saldo insuficiente. */
  sendTip: (creatorUsername: string, amount: number, postId?: number) => Promise<void>;
  /** Submete pedido de carregamento (fica pendente até aprovação do admin) */
  topUp: (amount: number, reference: string, comprovantivoBase64?: string, comprovantivoNome?: string) => Promise<void>;
  /** Desbloqueia conteúdo PPV. Lança erro se saldo insuficiente. */
  unlockPost: (postId: number, creatorUsername: string, preco: number) => Promise<void>;
  /** Subscreve a um criador. Lança erro se saldo insuficiente. */
  subscribe: (creatorUsername: string, preco: number) => Promise<void>;
  /** Verifica se o utilizador tem subscrição ativa do criador */
  isSubscribed: (creatorUsername: string) => boolean;
  /** Verifica se o utilizador desbloqueou este post */
  isPostUnlocked: (postId: number) => boolean;
  /** Obtém os dados completos do utilizador (incluindo dados bancários) */
  getMockUserData: () => MockUser | null;
  /** Guarda dados bancários do criador */
  saveDadosBancarios: (dados: DadosBancarios) => void;
  /** Solicita levantamento de ganhos (só dia 29). Lança erro se fora do prazo ou sem dados bancários. */
  requestWithdrawal: () => Promise<number>;
  /** Historial de transações do utilizador atual */
  getTransactionHistory: () => MockTransaction[];
  /** Força refresh do saldo (ex: após operação externa) */
  refreshSaldo: () => void;
  /** Atualiza o avatar do utilizador (funciona em modo real e mock) */
  updateAvatarUrl: (url: string) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function getMockSaldo(): number | null {
  try {
    const u = getCurrentMockUser();
    return u?.saldo ?? null;
  } catch { return null; }
}

function getMockGanhos(): number | null {
  try {
    const u = getCurrentMockUser();
    if (!u || u.tipoConta !== 'criador') return null;
    return u.ganhos ?? 0;
  } catch { return null; }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [token, setTokenState] = useState<string | null>(() => localStorage.getItem('xclusive_token'));
  const [mockUser, setMockUser] = useState<UserProfile | null>(() => getMockSession());
  const [isMockMode, setIsMockMode] = useState(false);
  const [saldo, setSaldo] = useState<number | null>(() => getMockSaldo());
  const [ganhos, setGanhos] = useState<number | null>(() => getMockGanhos());

  // Seed test accounts into mock store on first load
  useEffect(() => {
    seedMockUsersIfEmpty();
  }, []);

  const isMockToken = token?.startsWith('mock_token_') ?? false;

  const { data: apiUser, isLoading: isUserLoading, error } = useGetMe({
    query: {
      queryKey: ['/api/auth/me'],
      enabled: !!token && !isMockToken,
      retry: false,
      staleTime: 1000 * 60 * 5,
    }
  });

  const setToken = useCallback((newToken: string | null) => {
    if (newToken) {
      localStorage.setItem('xclusive_token', newToken);
      setTokenState(newToken);
    } else {
      localStorage.removeItem('xclusive_token');
      setTokenState(null);
    }
  }, []);

  /** Tenta renovar o access token via refresh cookie httpOnly.
   *  Devolve true se bem-sucedido, false se a sessão expirou. */
  const tryRefreshToken = useCallback(async (): Promise<boolean> => {
    try {
      const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
      const res = await fetch(`${base}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (data?.token) { setToken(data.token); return true; }
      return false;
    } catch { return false; }
  }, [setToken]);

  // Registar handlers de renovação no cliente API global (customFetch)
  useEffect(() => {
    setTokenRefreshHandler(async () => {
      try {
        const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
        const res = await fetch(`${base}/api/auth/refresh`, {
          method: 'POST',
          credentials: 'same-origin',
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (data?.token && typeof data.token === 'string') {
          setToken(data.token);
          return data.token;
        }
        return null;
      } catch {
        return null;
      }
    });

    setOnTokenRefreshed((newToken) => {
      localStorage.setItem('xclusive_token', newToken);
      setTokenState(newToken);
    });

    setOnSessionExpired(() => {
      localStorage.removeItem('xclusive_token');
      setTokenState(null);
    });

    return () => {
      setTokenRefreshHandler(null);
      setOnTokenRefreshed(null);
      setOnSessionExpired(null);
    };
  }, [setToken]);

  // Renovação proativa: agenda refresh ~1 min antes do access token expirar
  useEffect(() => {
    if (!token || isMockToken) return;
    const exp = parseTokenExp(token);
    if (!exp) return;
    const msUntilRefresh = (exp * 1000) - Date.now() - 60_000;
    if (msUntilRefresh <= 0) { tryRefreshToken(); return; }
    const timer = setTimeout(() => { tryRefreshToken(); }, msUntilRefresh);
    return () => clearTimeout(timer);
  }, [token, isMockToken, tryRefreshToken]);

  // Em 401/403: tenta refresh antes de fazer logout
  useEffect(() => {
    if (error && !isMockToken) {
      const status = (error as any)?.response?.status;
      if (status === 401 || status === 403) {
        tryRefreshToken().then(refreshed => {
          if (refreshed) {
            queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
          } else {
            setToken(null);
          }
        });
      }
    }
  }, [error, setToken, isMockToken, tryRefreshToken, queryClient]);

  // ─── Fetch real wallet balance from API ──────────────────────────────────────
  const fetchApiWallet = useCallback(async (currentToken: string) => {
    try {
      const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
      const res = await fetch(`${base}/api/wallet/balance`, {
        headers: { Authorization: `Bearer ${currentToken}` },
        credentials: 'same-origin',
      });
      if (!res.ok) return;
      const data = await res.json();
      if (typeof data.saldo === 'number') setSaldo(data.saldo);
      if (typeof data.ganhos === 'number') setGanhos(data.ganhos);
    } catch {
      // silently ignore — balance will refresh on next action
    }
  }, []);

  // Fetch real balance on mount and whenever the (non-mock) token changes
  useEffect(() => {
    if (!token || isMockToken) return;
    fetchApiWallet(token);
  }, [token, isMockToken, fetchApiWallet]);

  const refreshSaldo = useCallback(() => {
    if (isMockToken) {
      setSaldo(getMockSaldo());
      setGanhos(getMockGanhos());
    } else if (token) {
      fetchApiWallet(token);
    }
  }, [isMockToken, token, fetchApiWallet]);

  const login = async (data: LoginInput) => {
    // Always try the real API first — mock users may also exist in localStorage
    // from previous sessions, so we cannot short-circuit to mock based on email alone.
    try {
      const response = await apiLogin(data);
      setIsMockMode(false);
      setToken(response.token);
      queryClient.setQueryData(['/api/auth/me'], response.user);
      setLocation('/home');
      return;
    } catch (apiError: any) {
      const apiStatus: number | undefined = apiError?.response?.status ?? apiError?.status;
      // 4xx = credential rejection or client error — do NOT fall back to mock.
      if (apiStatus && apiStatus >= 400 && apiStatus < 500) throw apiError;
      // Network/server error — fall back to mock only if user is a known mock account.
      const knownMockUser = getMockUsers().find(u => u.email === data.email);
      if (!knownMockUser) throw apiError;
      const response = await mockLogin(data);
      setIsMockMode(true);
      setToken(response.token);
      setMockUser(response.user);
      setSaldo(getMockSaldo());
      setGanhos(getMockGanhos());
      setLocation('/home');
    }
  };

  const register = async (data: RegisterInput & { pais?: string; telefone?: string; tipoConta?: string }) => {
    try {
      const response = await apiRegister(data);
      setIsMockMode(false);
      setToken(response.token);
      queryClient.setQueryData(['/api/auth/me'], response.user);
      setLocation('/onboarding');
      return;
    } catch (apiError: any) {
      const apiStatus: number | undefined = apiError?.response?.status ?? apiError?.status;
      const isClientError = apiStatus && apiStatus >= 400 && apiStatus < 500;
      if (isClientError) throw apiError;
      const response = await mockRegister(data);
      setIsMockMode(true);
      setToken(response.token);
      setMockUser(response.user);
      setSaldo(getMockSaldo());
      setGanhos(getMockGanhos());
      setLocation('/onboarding');
    }
  };

  const sendTip = useCallback(async (creatorUsername: string, amount: number, postId?: number) => {
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
      throw new Error('Valor de gorjeta inválido.');
    }

    // ── Real API mode ──────────────────────────────────────────────────────────
    if (token && !isMockToken) {
      if (!postId) throw new Error('ID do post em falta.');
      const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
      const res = await fetch(`${base}/api/posts/${postId}/gorjeta`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        credentials: 'same-origin',
        body: JSON.stringify({ valor: amount }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || 'Erro ao enviar gorjeta.');
      }
      // Actualizar saldo local a partir da API após débito bem-sucedido
      await fetchApiWallet(token);
      return;
    }

    // ── Mock mode ──────────────────────────────────────────────────────────────
    const session = JSON.parse(localStorage.getItem(MOCK_SESSION_KEY) || 'null');
    if (!session) throw new Error('Não estás autenticado.');
    const users = getMockUsers();
    const senderIdx = users.findIndex(u => u.id === session.userId);
    if (senderIdx === -1) throw new Error('Utilizador não encontrado.');
    if (users[senderIdx].username === creatorUsername) throw new Error('Não podes dar gorjeta ao teu próprio conteúdo.');
    const senderSaldo = users[senderIdx].saldo ?? 0;
    if (senderSaldo < amount) throw new Error('Saldo insuficiente. Carrega a tua carteira.');
    const creatorIdx = users.findIndex(u => u.username === creatorUsername);
    if (creatorIdx === -1) throw new Error('Criador não encontrado.');
    const freshUsers = getMockUsers();
    const freshSenderIdx = freshUsers.findIndex(u => u.id === session.userId);
    const freshCreatorIdx = freshUsers.findIndex(u => u.username === creatorUsername);
    if (freshSenderIdx === -1 || freshCreatorIdx === -1) throw new Error('Dados inconsistentes. Tenta de novo.');
    const freshSaldo = freshUsers[freshSenderIdx].saldo ?? 0;
    if (freshSaldo < amount) throw new Error('Saldo insuficiente. Carrega a tua carteira.');
    freshUsers[freshSenderIdx].saldo = freshSaldo - amount;
    // Creator receives 90% as ganhos
    freshUsers[freshCreatorIdx].ganhos = (freshUsers[freshCreatorIdx].ganhos ?? 0) + Math.floor(amount * 0.9);
    saveMockUsers(freshUsers);
    const txs = getTransactions();
    txs.push({ id: Date.now(), fromUserId: session.userId, toUsername: creatorUsername, amount, postId, tipo: 'gorjeta', criadoEm: new Date().toISOString() });
    saveTransactions(txs);
    setSaldo(freshUsers[freshSenderIdx].saldo);
  }, [token, isMockToken, fetchApiWallet]);

  const topUp = useCallback(async (amount: number, reference: string, comprovantivoBase64?: string, comprovantivoNome?: string) => {
    if (!Number.isFinite(amount) || amount < 500) {
      throw new Error('Valor mínimo de carregamento: 500 Kz.');
    }

    // ── Real API mode ──────────────────────────────────────────────────────────
    if (token && !isMockToken) {
      const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
      const res = await fetch(`${base}/api/wallet/topup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        credentials: 'same-origin',
        body: JSON.stringify({ amount, reference, comprovantivoBase64, comprovantivoNome }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || 'Erro ao submeter pedido de carregamento.');
      }
      return;
    }

    // ── Mock mode ──────────────────────────────────────────────────────────────
    const session = JSON.parse(localStorage.getItem(MOCK_SESSION_KEY) || 'null');
    if (!session) throw new Error('Não estás autenticado.');
    const freshUsers = getMockUsers();
    const user = freshUsers.find(u => u.id === session.userId);
    if (!user) throw new Error('Utilizador não encontrado.');
    // Regista o pedido como pendente — o admin aprova manualmente
    const reqs = _getTopUpRequests();
    // Evita pedidos duplicados com a mesma referência
    if (reqs.some(r => r.reference === reference)) {
      throw new Error('Este pedido já foi submetido.');
    }
    const newReq: _TopUpRequest = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      userId: session.userId,
      username: user.username,
      nomeCompleto: user.nomeCompleto,
      amount,
      reference,
      criadoEm: new Date().toISOString(),
      status: 'pendente',
      ...(comprovantivoBase64 ? { comprovantivoBase64, comprovantivoNome: comprovantivoNome ?? 'comprovativo.pdf' } : {}),
    };
    reqs.push(newReq);
    _saveTopUpRequests(reqs);
    // Não adiciona saldo agora — só após aprovação do admin
  }, [token, isMockToken]);

  const unlockPost = useCallback(async (postId: number, creatorUsername: string, preco: number) => {
    const session = JSON.parse(localStorage.getItem(MOCK_SESSION_KEY) || 'null');
    if (!session) throw new Error('Não estás autenticado.');
    const freshUsers = getMockUsers();
    const senderIdx = freshUsers.findIndex(u => u.id === session.userId);
    if (senderIdx === -1) throw new Error('Utilizador não encontrado.');
    // Already unlocked?
    if ((freshUsers[senderIdx].conteudoDesbloqueado ?? []).includes(postId)) return;
    const saldo = freshUsers[senderIdx].saldo ?? 0;
    if (saldo < preco) throw new Error('Saldo insuficiente. Carrega a tua carteira primeiro.');
    freshUsers[senderIdx].saldo = saldo - preco;
    freshUsers[senderIdx].conteudoDesbloqueado = [...(freshUsers[senderIdx].conteudoDesbloqueado ?? []), postId];
    // Creator gets 90% as ganhos
    const creatorIdx = freshUsers.findIndex(u => u.username === creatorUsername);
    if (creatorIdx !== -1) {
      freshUsers[creatorIdx].ganhos = (freshUsers[creatorIdx].ganhos ?? 0) + Math.floor(preco * 0.9);
    }
    saveMockUsers(freshUsers);
    const txs = getTransactions();
    txs.push({
      id: Date.now(),
      fromUserId: session.userId,
      toUsername: creatorUsername,
      amount: preco,
      postId,
      tipo: 'desbloqueio',
      descricao: `Desbloqueio de conteúdo de @${creatorUsername}`,
      criadoEm: new Date().toISOString(),
    });
    saveTransactions(txs);
    setSaldo(freshUsers[senderIdx].saldo);
  }, []);

  const subscribe = useCallback(async (creatorUsername: string, preco: number) => {

    // ── Real API mode ──────────────────────────────────────────────────────────
    if (token && !isMockToken) {
      const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

      // 1. Resolver o planoId do criador (endpoint público, sem auth)
      const planRes = await fetch(`${base}/api/users/${creatorUsername}/subscription-plan`, {
        credentials: 'same-origin',
      });
      if (!planRes.ok) {
        const err = await planRes.json().catch(() => ({}));
        throw new Error((err as any).error || 'Criador não tem plano de subscrição disponível.');
      }
      const plan = await planRes.json() as { id: number; preco: number };

      // 2. Submeter subscrição com planoId e precoEsperado (protecção contra race condition de preço)
      const res = await fetch(`${base}/api/subscriptions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        credentials: 'same-origin',
        body: JSON.stringify({ planoId: plan.id, precoEsperado: plan.preco }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || 'Erro ao processar subscrição.');
      }
      // Actualizar saldo local a partir da API após débito bem-sucedido
      await fetchApiWallet(token);
      return;
    }

    // ── Mock mode ──────────────────────────────────────────────────────────────
    const session = JSON.parse(localStorage.getItem(MOCK_SESSION_KEY) || 'null');
    if (!session) throw new Error('Não estás autenticado.');
    const freshUsers = getMockUsers();
    const senderIdx = freshUsers.findIndex(u => u.id === session.userId);
    if (senderIdx === -1) throw new Error('Utilizador não encontrado.');
    if (freshUsers[senderIdx].username === creatorUsername) throw new Error('Não podes subscrever o teu próprio canal.');
    // Check existing active subscription
    const existingSub = freshUsers[senderIdx].subscricoes?.[creatorUsername];
    if (existingSub && new Date(existingSub.expira) > new Date()) {
      throw new Error('Já tens uma subscrição ativa para este criador.');
    }
    const saldo = freshUsers[senderIdx].saldo ?? 0;
    if (saldo < preco) throw new Error('Saldo insuficiente. Carrega a tua carteira primeiro.');
    freshUsers[senderIdx].saldo = saldo - preco;
    // Subscription expires 30 days from now
    const expira = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    freshUsers[senderIdx].subscricoes = {
      ...(freshUsers[senderIdx].subscricoes ?? {}),
      [creatorUsername]: { expira, preco },
    };
    // Creator gets 90% as ganhos
    const creatorIdx = freshUsers.findIndex(u => u.username === creatorUsername);
    if (creatorIdx !== -1) {
      freshUsers[creatorIdx].ganhos = (freshUsers[creatorIdx].ganhos ?? 0) + Math.floor(preco * 0.9);
    }
    saveMockUsers(freshUsers);
    const txs = getTransactions();
    txs.push({
      id: Date.now(),
      fromUserId: session.userId,
      toUsername: creatorUsername,
      amount: preco,
      tipo: 'subscricao',
      descricao: `Subscrição mensal de @${creatorUsername}`,
      criadoEm: new Date().toISOString(),
    });
    saveTransactions(txs);
    setSaldo(freshUsers[senderIdx].saldo);
  }, [token, isMockToken, fetchApiWallet]);

  const isSubscribed = useCallback((creatorUsername: string): boolean => {
    const u = getCurrentMockUser();
    if (!u) return false;
    const sub = u.subscricoes?.[creatorUsername];
    if (!sub) return false;
    return new Date(sub.expira) > new Date();
  }, []);

  const isPostUnlocked = useCallback((postId: number): boolean => {
    const u = getCurrentMockUser();
    if (!u) return false;
    return (u.conteudoDesbloqueado ?? []).includes(postId);
  }, []);

  const getMockUserData = useCallback((): MockUser | null => {
    return getCurrentMockUser();
  }, []);

  const saveDadosBancarios = useCallback((dados: DadosBancarios) => {
    const session = JSON.parse(localStorage.getItem(MOCK_SESSION_KEY) || 'null');
    if (!session) return;
    const freshUsers = getMockUsers();
    const idx = freshUsers.findIndex(u => u.id === session.userId);
    if (idx === -1) return;
    freshUsers[idx].dadosBancarios = dados;
    saveMockUsers(freshUsers);
  }, []);

  const requestWithdrawal = useCallback(async (): Promise<number> => {
    const today = new Date();
    if (today.getDate() !== 29) {
      throw new Error('Os levantamentos só estão disponíveis no dia 29 de cada mês.');
    }
    const session = JSON.parse(localStorage.getItem(MOCK_SESSION_KEY) || 'null');
    if (!session) throw new Error('Não estás autenticado.');
    const freshUsers = getMockUsers();
    const idx = freshUsers.findIndex(u => u.id === session.userId);
    if (idx === -1) throw new Error('Utilizador não encontrado.');
    if (!freshUsers[idx].dadosBancarios) {
      throw new Error('Tens de adicionar os teus dados bancários antes de solicitar um levantamento.');
    }
    const ganhosDisponiveis = freshUsers[idx].ganhos ?? 0;
    if (ganhosDisponiveis < 1000) {
      throw new Error(`Saldo mínimo para levantamento: 1.000 Kz. Tens ${ganhosDisponiveis.toLocaleString('pt-PT')} Kz disponíveis.`);
    }
    freshUsers[idx].ganhos = 0;
    saveMockUsers(freshUsers);
    setGanhos(0);
    const txs = getTransactions();
    txs.push({
      id: Date.now(),
      fromUserId: session.userId,
      toUsername: freshUsers[idx].username,
      amount: ganhosDisponiveis,
      tipo: 'levantamento',
      descricao: `Levantamento para ${freshUsers[idx].dadosBancarios!.banco}`,
      criadoEm: new Date().toISOString(),
    });
    saveTransactions(txs);
    return ganhosDisponiveis;
  }, []);

  const getTransactionHistory = useCallback((): MockTransaction[] => {
    const session = JSON.parse(localStorage.getItem(MOCK_SESSION_KEY) || 'null');
    if (!session) return [];
    const all = getTransactions();
    return all.filter(tx => tx.fromUserId === session.userId).sort((a, b) => b.id - a.id);
  }, []);

  const updateAvatarUrl = useCallback((url: string) => {
    const users = getMockUsers();
    const currentUser = isMockToken ? mockUser : (apiUser || null);
    if (currentUser) {
      const idx = users.findIndex(u => u.id === currentUser.id);
      if (idx !== -1) {
        users[idx].avatarUrl = url;
        saveMockUsers(users);
      }
    }
    if (isMockToken && mockUser) {
      setMockUser({ ...mockUser, avatarUrl: url });
    }
    queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
  }, [isMockToken, mockUser, apiUser, queryClient]);

  const updateTipoConta = useCallback((tipo: 'pessoal' | 'criador') => {
    const users = getMockUsers();
    const currentUser = isMockToken ? mockUser : (apiUser || null);
    if (currentUser) {
      const idx = users.findIndex(u => u.id === currentUser.id);
      if (idx !== -1) {
        users[idx].tipoConta = tipo;
        users[idx].verificado = true;
        saveMockUsers(users);
      }
    }
    if (isMockToken && mockUser) {
      const updated: UserProfile = { ...mockUser, tipoConta: tipo, verificado: true };
      setMockUser(updated);
      const session = localStorage.getItem(MOCK_SESSION_KEY);
      if (session) {
        try {
          const parsed = JSON.parse(session);
          localStorage.setItem(MOCK_SESSION_KEY, JSON.stringify(parsed));
        } catch {}
      }
    }
    queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
  }, [isMockToken, mockUser, apiUser, queryClient]);

  const logout = async () => {
    try {
      if (isMockToken) {
        await mockLogout();
      } else {
        await apiLogout();
      }
    } catch (err) {
      console.error('Logout failed:', err);
    } finally {
      setToken(null);
      setMockUser(null);
      setIsMockMode(false);
      setSaldo(null);
      setGanhos(null);
      queryClient.clear();
      setLocation('/');
    }
  };

  const resolvedUser = isMockToken ? mockUser : (apiUser || null);
  const isLoading = token && !isMockToken ? isUserLoading : false;
  const isAuthenticated = !!resolvedUser && !!token;

  return (
    <AuthContext.Provider value={{
      user: resolvedUser,
      isLoading,
      isAuthenticated,
      isMockMode: isMockToken,
      saldo,
      ganhos,
      login,
      register,
      logout,
      setToken,
      updateTipoConta,
      sendTip,
      topUp,
      unlockPost,
      subscribe,
      isSubscribed,
      isPostUnlocked,
      getMockUserData,
      saveDadosBancarios,
      requestWithdrawal,
      getTransactionHistory,
      refreshSaldo,
      updateAvatarUrl,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
