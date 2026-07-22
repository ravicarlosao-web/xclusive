import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { adminApi } from '@/lib/api';

interface AdminUser {
  id: number;
  name: string;
  email: string;
  avatar?: string;
}

interface AdminAuthContextType {
  isAuthenticated: boolean;
  isInitialized: boolean;
  user: AdminUser | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
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

  const login = async (email: string, password: string) => {
    const data = await adminApi.login(email, password);
    localStorage.setItem('admin_token', data.token);
    localStorage.setItem('admin_user', JSON.stringify(data.user));
    localStorage.setItem('admin_login_time', Date.now().toString());
    setUser(data.user);
    setIsAuthenticated(true);
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
    <AdminAuthContext.Provider value={{ isAuthenticated, isInitialized, user, login, logout }}>
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
