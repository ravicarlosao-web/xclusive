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
  criadoEm: string;
}

function getMockUsers(): MockUser[] {
  try { return JSON.parse(localStorage.getItem(MOCK_KEY) || '[]'); } catch { return []; }
}
function saveMockUsers(users: MockUser[]) {
  localStorage.setItem(MOCK_KEY, JSON.stringify(users));
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
  login: (data: LoginInput) => Promise<void>;
  register: (data: RegisterInput & { pais?: string; telefone?: string; tipoConta?: string }) => Promise<void>;
  logout: () => Promise<void>;
  setToken: (token: string | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [token, setTokenState] = useState<string | null>(() => localStorage.getItem('xclusive_token'));
  const [mockUser, setMockUser] = useState<UserProfile | null>(() => getMockSession());
  const [isMockMode, setIsMockMode] = useState(false);

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
    // Try real API first
    try {
      const response = await apiLogin(data);
      setIsMockMode(false);
      setToken(response.token);
      queryClient.setQueryData(['/api/auth/me'], response.user);
      setLocation('/home');
      return;
    } catch (apiError: any) {
      // If network error or 5xx (not 401/403), fall back to mock
      const isNetworkOrServerError = !apiError?.response || apiError?.response?.status >= 500;
      if (isNetworkOrServerError) {
        try {
          const response = await mockLogin(data);
          setIsMockMode(true);
          setToken(response.token);
          setMockUser(response.user);
          setLocation('/home');
          return;
        } catch (mockError: any) {
          throw mockError;
        }
      }
      throw apiError;
    }
  };

  const register = async (data: RegisterInput & { pais?: string; telefone?: string; tipoConta?: string }) => {
    // Try real API first
    try {
      const response = await apiRegister(data);
      setIsMockMode(false);
      setToken(response.token);
      queryClient.setQueryData(['/api/auth/me'], response.user);
      setLocation('/onboarding');
      return;
    } catch (apiError: any) {
      // Fall back to mock on network/server error
      const isNetworkOrServerError = !apiError?.response || apiError?.response?.status >= 500;
      if (isNetworkOrServerError) {
        try {
          const response = await mockRegister(data);
          setIsMockMode(true);
          setToken(response.token);
          setMockUser(response.user);
          setLocation('/onboarding');
          return;
        } catch (mockError: any) {
          throw mockError;
        }
      }
      throw apiError;
    }
  };

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
      login,
      register,
      logout,
      setToken,
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
