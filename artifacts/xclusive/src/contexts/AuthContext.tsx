import { createContext, useContext, ReactNode, useEffect, useState, useCallback } from 'react';
import { useLocation } from 'wouter';
import { UserProfile, LoginInput, RegisterInput } from '@workspace/api-client-react';
import { useGetMe, login as apiLogin, register as apiRegister, logout as apiLogout, setAuthTokenGetter } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

// Wire the API client to always send the stored JWT token
setAuthTokenGetter(() => localStorage.getItem('xclusive_token'));

interface AuthContextType {
  user: UserProfile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (data: LoginInput) => Promise<void>;
  register: (data: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  setToken: (token: string) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [token, setTokenState] = useState<string | null>(() => localStorage.getItem('xclusive_token'));

  // Define headers with token for all customFetch requests if needed
  // Note: Assuming customFetch intercepts the localStorage token, but we trigger re-renders via react-query
  
  const { data: user, isLoading: isUserLoading, error } = useGetMe({
    query: {
      queryKey: ['/api/auth/me'],
      enabled: !!token,
      retry: false,
      staleTime: 1000 * 60 * 5, // 5 minutes
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

  // Handle auto logout on 401
  useEffect(() => {
    if (error) {
      setToken(null);
    }
  }, [error, setToken]);

  const login = async (data: LoginInput) => {
    try {
      const response = await apiLogin(data);
      setToken(response.token);
      queryClient.setQueryData(['/api/auth/me'], response.user);
      setLocation('/home');
    } catch (err) {
      throw err;
    }
  };

  const register = async (data: RegisterInput) => {
    try {
      const response = await apiRegister(data);
      setToken(response.token);
      queryClient.setQueryData(['/api/auth/me'], response.user);
      setLocation('/onboarding');
    } catch (err) {
      throw err;
    }
  };

  const logout = async () => {
    try {
      await apiLogout();
    } catch (err) {
      console.error('Logout failed:', err);
    } finally {
      setToken(null);
      queryClient.clear();
      setLocation('/');
    }
  };

  const isLoading = token ? isUserLoading : false;
  const isAuthenticated = !!user && !!token;

  return (
    <AuthContext.Provider value={{ user: user || null, isLoading, isAuthenticated, login, register, logout, setToken }}>
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
