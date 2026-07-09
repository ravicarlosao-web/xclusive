import { createContext, useContext, ReactNode, useEffect, useState, useCallback } from 'react';
import { useLocation } from 'wouter';
import { UserProfile, LoginInput, RegisterInput } from '@workspace/api-client-react';
import { useGetMe, login as apiLogin, register as apiRegister, logout as apiLogout, setAuthTokenGetter } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

// Wire the API client to always send the stored JWT token
setAuthTokenGetter(() => localStorage.getItem('xclusive_token'));

// ─── Mock store helpers (DB-less mode) ───────────────────────────────────────
const MOCK_KEY = 'xclusive_mock_users';
const MOCK_SESSION_KEY = 'xclusive_mock_session';

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
  /** Saldo em Kwanza (Kz) — mock carteira */
  saldo: number;
  criadoEm: string;
}

const MOCK_TRANSACTIONS_KEY = 'xclusive_mock_transactions';
interface MockTransaction {
  id: number;
  fromUserId: number;
  toUsername: string;
  amount: number;
  postId?: number;
  tipo: 'gorjeta';
  criadoEm: string;
}
function getTransactions(): MockTransaction[] {
  try { return JSON.parse(localStorage.getItem(MOCK_TRANSACTIONS_KEY) || '[]'); } catch { return []; }
}
function saveTransactions(txs: MockTransaction[]) {
  localStorage.setItem(MOCK_TRANSACTIONS_KEY, JSON.stringify(txs));
}

function getMockUsers(): MockUser[] {
  try { return JSON.parse(localStorage.getItem(MOCK_KEY) || '[]'); } catch { return []; }
}
function saveMockUsers(users: MockUser[]) {
  localStorage.setItem(MOCK_KEY, JSON.stringify(users));
}

// Pre-seed test accounts so they work even without a real DB
const SEED_USERS: MockUser[] = [
  { id: 1, nomeCompleto: 'Demo User', username: 'demo', email: 'demo@xclusive.pt', _devPassword: 'password123', dataNascimento: '1995-06-15', tipoConta: 'pessoal', pais: 'Angola', verificado: false, avatarUrl: 'https://i.pravatar.cc/150?img=12', capaUrl: null, bio: 'Utilizador de demonstração 👋', link: null, nomeExibicao: 'Demo User', totalSeguidores: 24, totalSeguindo: 61, totalPublicacoes: 0, saldo: 5000, criadoEm: '2024-01-01T00:00:00.000Z' },
  { id: 2, nomeCompleto: 'Ana Costa', username: 'ana', email: 'ana@xclusive.pt', _devPassword: 'password123', dataNascimento: '1998-03-22', tipoConta: 'criador', pais: 'Angola', verificado: true, avatarUrl: 'https://i.pravatar.cc/150?img=47', capaUrl: null, bio: '📸 Fotografia & Lifestyle | Luanda 🇦🇴', link: 'https://xclusive.ao/ana', nomeExibicao: 'Ana Costa', totalSeguidores: 1248, totalSeguindo: 182, totalPublicacoes: 34, saldo: 12500, criadoEm: '2024-01-01T00:00:00.000Z' },
  { id: 3, nomeCompleto: 'Marcos Silva', username: 'marcos', email: 'marcos@xclusive.pt', _devPassword: 'password123', dataNascimento: '1996-09-10', tipoConta: 'criador', pais: 'Angola', verificado: true, avatarUrl: 'https://i.pravatar.cc/150?img=33', capaUrl: null, bio: '🎵 Músico | Produtor | Luanda', link: null, nomeExibicao: 'Marcos Silva', totalSeguidores: 3102, totalSeguindo: 95, totalPublicacoes: 57, saldo: 34800, criadoEm: '2024-01-01T00:00:00.000Z' },
  { id: 4, nomeCompleto: 'Sofia Mendes', username: 'sofia', email: 'sofia@xclusive.pt', _devPassword: 'password123', dataNascimento: '2000-12-05', tipoConta: 'criador', pais: 'Moçambique', verificado: false, avatarUrl: 'https://i.pravatar.cc/150?img=44', capaUrl: null, bio: '💄 Beleza & Moda | Maputo 🇲🇿', link: null, nomeExibicao: 'Sofia Mendes', totalSeguidores: 892, totalSeguindo: 312, totalPublicacoes: 22, saldo: 8200, criadoEm: '2024-01-01T00:00:00.000Z' },
  { id: 5, nomeCompleto: 'Pedro Alves', username: 'pedro', email: 'pedro@xclusive.pt', _devPassword: 'password123', dataNascimento: '1993-07-18', tipoConta: 'criador', pais: 'Angola', verificado: true, avatarUrl: 'https://i.pravatar.cc/150?img=60', capaUrl: null, bio: '🏋️ Fitness & Nutrição | Luanda', link: null, nomeExibicao: 'Pedro Alves', totalSeguidores: 5430, totalSeguindo: 47, totalPublicacoes: 89, saldo: 67300, criadoEm: '2024-01-01T00:00:00.000Z' },
  { id: 6, nomeCompleto: 'Luna Ferreira', username: 'luna', email: 'luna@xclusive.pt', _devPassword: 'password123', dataNascimento: '2001-04-30', tipoConta: 'criador', pais: 'África do Sul', verificado: false, avatarUrl: 'https://i.pravatar.cc/150?img=56', capaUrl: null, bio: '🎨 Arte Digital | Cape Town 🇿🇦', link: null, nomeExibicao: 'Luna Ferreira', totalSeguidores: 421, totalSeguindo: 203, totalPublicacoes: 15, saldo: 3100, criadoEm: '2024-01-01T00:00:00.000Z' },
];

function seedMockUsersIfEmpty() {
  let existing = getMockUsers();
  // Migrate: give saldo to any user who doesn't have it yet
  let migrated = false;
  existing = existing.map(u => {
    if ((u as any).saldo === undefined) { migrated = true; return { ...u, saldo: 5000 }; }
    return u;
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
// ─────────────────────────────────────────────────────────────────────────────

interface AuthContextType {
  user: UserProfile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isMockMode: boolean;
  /** Saldo da carteira em Kz (null se não autenticado ou modo API real) */
  saldo: number | null;
  login: (data: LoginInput) => Promise<void>;
  register: (data: RegisterInput & { pais?: string; telefone?: string; tipoConta?: string }) => Promise<void>;
  logout: () => Promise<void>;
  setToken: (token: string | null) => void;
  /** Update the current user's account type locally (mock + optimistic). Used by KYC flow. */
  updateTipoConta: (tipo: 'pessoal' | 'criador') => void;
  /** Envia gorjeta ao criador. Lança erro se saldo insuficiente. */
  sendTip: (creatorUsername: string, amount: number, postId?: number) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function getMockSaldo(): number | null {
  try {
    const session = JSON.parse(localStorage.getItem(MOCK_SESSION_KEY) || 'null');
    if (!session) return null;
    const users = getMockUsers();
    const u = users.find(u => u.id === session.userId);
    return (u as any)?.saldo ?? null;
  } catch { return null; }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [token, setTokenState] = useState<string | null>(() => localStorage.getItem('xclusive_token'));
  const [mockUser, setMockUser] = useState<UserProfile | null>(() => getMockSession());
  const [isMockMode, setIsMockMode] = useState(false);
  const [saldo, setSaldo] = useState<number | null>(() => getMockSaldo());

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

  // Auto logout only on explicit 401/403 — not on transient network/5xx errors
  useEffect(() => {
    if (error && !isMockToken) {
      const status = (error as any)?.response?.status;
      if (status === 401 || status === 403) {
        setToken(null);
      }
    }
  }, [error, setToken, isMockToken]);

  const login = async (data: LoginInput) => {
    try {
      const response = await apiLogin(data);
      setIsMockMode(false);
      setToken(response.token);
      queryClient.setQueryData(['/api/auth/me'], response.user);
      setLocation('/home');
      return;
    } catch (apiError: any) {
      const apiStatus: number | undefined = apiError?.response?.status ?? apiError?.status;
      // Only surface API 4xx errors as real credential failures — everything else falls to mock
      const isCredentialRejection = apiStatus && apiStatus >= 400 && apiStatus < 500;
      if (isCredentialRejection) throw apiError;
      // API is broken/unreachable — try mock store (has pre-seeded test accounts)
      const response = await mockLogin(data); // throws with user-friendly message on wrong password
      setIsMockMode(true);
      setToken(response.token);
      setMockUser(response.user);
      setSaldo(getMockSaldo());
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
      // API broken — register in mock store
      const response = await mockRegister(data);
      setIsMockMode(true);
      setToken(response.token);
      setMockUser(response.user);
      setSaldo(getMockSaldo());
      setLocation('/onboarding');
    }
  };

  const sendTip = useCallback(async (creatorUsername: string, amount: number, postId?: number) => {
    // Validate amount at service layer (not just UI)
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
      throw new Error('Valor de gorjeta inválido.');
    }
    const session = JSON.parse(localStorage.getItem(MOCK_SESSION_KEY) || 'null');
    if (!session) throw new Error('Não estás autenticado.');
    const users = getMockUsers();
    const senderIdx = users.findIndex(u => u.id === session.userId);
    if (senderIdx === -1) throw new Error('Utilizador não encontrado.');
    // Self-tip prevention at service layer
    if (users[senderIdx].username === creatorUsername) throw new Error('Não podes dar gorjeta ao teu próprio conteúdo.');
    const senderSaldo = users[senderIdx].saldo ?? 0;
    if (senderSaldo < amount) throw new Error('Saldo insuficiente. Carrega a tua carteira.');
    const creatorIdx = users.findIndex(u => u.username === creatorUsername);
    if (creatorIdx === -1) throw new Error('Criador não encontrado.');
    // Atomic read-modify-write with optimistic concurrency: re-read store immediately before write
    const freshUsers = getMockUsers();
    const freshSenderIdx = freshUsers.findIndex(u => u.id === session.userId);
    const freshCreatorIdx = freshUsers.findIndex(u => u.username === creatorUsername);
    if (freshSenderIdx === -1 || freshCreatorIdx === -1) throw new Error('Dados inconsistentes. Tenta de novo.');
    const freshSaldo = freshUsers[freshSenderIdx].saldo ?? 0;
    if (freshSaldo < amount) throw new Error('Saldo insuficiente. Carrega a tua carteira.');
    freshUsers[freshSenderIdx].saldo = freshSaldo - amount;
    freshUsers[freshCreatorIdx].saldo = (freshUsers[freshCreatorIdx].saldo ?? 0) + amount;
    saveMockUsers(freshUsers);
    const txs = getTransactions();
    txs.push({ id: Date.now(), fromUserId: session.userId, toUsername: creatorUsername, amount, postId, tipo: 'gorjeta', criadoEm: new Date().toISOString() });
    saveTransactions(txs);
    setSaldo(freshUsers[freshSenderIdx].saldo);
  }, []);

  const updateTipoConta = useCallback((tipo: 'pessoal' | 'criador') => {
    // Update mock store
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
    // Update in-memory mock session
    if (isMockToken && mockUser) {
      const updated: UserProfile = { ...mockUser, tipoConta: tipo, verificado: true };
      setMockUser(updated);
      const session = localStorage.getItem(MOCK_SESSION_KEY);
      if (session) {
        try {
          const parsed = JSON.parse(session);
          localStorage.setItem(MOCK_SESSION_KEY, JSON.stringify(parsed)); // session holds userId, user resolved dynamically
        } catch {}
      }
    }
    // For real API mode: invalidate so useGetMe refetches
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
      login,
      register,
      logout,
      setToken,
      updateTipoConta,
      sendTip,
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
