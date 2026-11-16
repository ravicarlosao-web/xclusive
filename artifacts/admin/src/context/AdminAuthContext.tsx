import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { adminApi } from '@/lib/api';

interface AdminUser {
  id: number;
  name: string;
  email: string;
  avatar?: string;
  /** true: a palavra-passe tem de ser trocada; o painel só mostra o formulário de troca. */
  trocaPasswordObrigatoria?: boolean;
  role?: string;
  /** true (modo obrigatório): sem TOTP, o painel só mostra a página de ativação até estar concluída. */
  totpAtivacaoNecessaria?: boolean;
}

/** Resultado do passo 1 do login: ou a sessão ficou aberta, ou o servidor pede o 2.º passo (o pré-token vive só em memória do ecrã de login). */
export type ResultadoLogin = { totpNecessario: false } | { totpNecessario: true; preAuth: string; expiresIn: number };

interface AdminAuthContextType {
  isAuthenticated: boolean;
  isInitialized: boolean;
  user: AdminUser | null;
  login: (email: string, password: string) => Promise<ResultadoLogin>;
  /** 2.º passo do login (TOTP ou código de recuperação). Só aqui a sessão fica aberta. */
  loginTotp: (preAuth: string, entrada: { codigo: string } | { recuperacao: string }) => Promise<void>;
  logout: () => void;
  /** Depois de ativar o TOTP: guarda o token novo (as outras sessões terminaram). Em modo obrigatório a marca só cai em `concluirAtivacaoObrigatoria` (para o ecrã dos códigos não desaparecer). */
  aposAtivarTotp: (token: string) => void;
  concluirAtivacaoObrigatoria: () => void;
  /** Depois de trocar a palavra-passe: guarda o token novo (a sessão antiga deixou de valer) e limpa a marca de troca obrigatória. */
  aposTrocaPassword: (token: string) => void;
}

const AdminAuthContext = createContext<AdminAuthContextType | undefined>(undefined);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [user, setUser] = useState<AdminUser | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    const storedUser = localStorage.getItem('admin_user');
    const loginTime = localStorage.getItem('admin_login_time');
    
    if (token && storedUser && loginTime) {
      // Check 4-hour TTL
      if (Date.now() - parseInt(loginTime, 10) < 4 * 60 * 60 * 1000) {
        try {
          setUser(JSON.parse(storedUser));
          setIsAuthenticated(true);
        } catch (e) {
          logout();
        }
      } else {
        logout();
      }
    }
    setIsInitialized(true);
  }, []);

  const abrirSessao = (data: any) => {
    const utilizador = data.totpAtivacaoNecessaria ? { ...data.user, totpAtivacaoNecessaria: true } : data.user;
    localStorage.setItem('admin_token', data.token);
    localStorage.setItem('admin_user', JSON.stringify(utilizador));
    localStorage.setItem('admin_login_time', Date.now().toString());
    setUser(utilizador);
    setIsAuthenticated(true);
  };

  const login = async (email: string, password: string): Promise<ResultadoLogin> => {
    const data = await adminApi.login(email, password);
    // Conta com TOTP: ainda NÃO há sessão (nem token) — só o pré-token, que nunca se guarda em armazenamento.
    if (data.totpNecessario) return { totpNecessario: true, preAuth: data.preAuth, expiresIn: data.expiresIn ?? 300 };
    abrirSessao(data);
    return { totpNecessario: false };
  };

  const loginTotp = async (preAuth: string, entrada: { codigo: string } | { recuperacao: string }) => {
    abrirSessao(await adminApi.loginTotp(preAuth, entrada));
  };

  const aposAtivarTotp = (token: string) => {
    localStorage.setItem('admin_token', token);
    localStorage.setItem('admin_login_time', Date.now().toString());
  };

  const concluirAtivacaoObrigatoria = () => {
    if (!user) return;
    const atualizado = { ...user, totpAtivacaoNecessaria: false };
    localStorage.setItem('admin_user', JSON.stringify(atualizado));
    setUser(atualizado);
  };

  const aposTrocaPassword = (token: string) => {
    localStorage.setItem('admin_token', token);
    localStorage.setItem('admin_login_time', Date.now().toString());
    const atualizado = user ? { ...user, trocaPasswordObrigatoria: false } : null;
    if (atualizado) localStorage.setItem('admin_user', JSON.stringify(atualizado));
    setUser(atualizado);
  };

  const logout = () => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    localStorage.removeItem('admin_login_time');
    setUser(null);
    setIsAuthenticated(false);
    window.location.href = import.meta.env.BASE_URL + 'login';
  };

  return (
    <AdminAuthContext.Provider value={{ isAuthenticated, isInitialized, user, login, loginTotp, logout, aposTrocaPassword, aposAtivarTotp, concluirAtivacaoObrigatoria }}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  const context = useContext(AdminAuthContext);
  if (context === undefined) {
    throw new Error('useAdminAuth must be used within an AdminAuthProvider');
  }
  return context;
}
