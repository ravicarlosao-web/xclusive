import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/layouts/AppLayout';
import { useEffect } from 'react';

// Pages
import Landing from '@/pages/landing';
import Login from '@/pages/login';
import Register from '@/pages/register';
import Home from '@/pages/home';
import Profile from '@/pages/profile';
import NotFound from '@/pages/not-found';

import Explore from '@/pages/explore';
import Reels from '@/pages/reels';
import MessagesList from '@/pages/messages';
import MessageThread from '@/pages/message-thread';
import Notifications from '@/pages/notifications';
import Settings from '@/pages/settings';
import Monetization from '@/pages/monetization';
import Onboarding from '@/pages/onboarding';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function ProtectedRoute({ component: Component, ...rest }: { component: any, path: string }) {
  const { isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      setLocation('/login');
    }
  }, [isLoading, isAuthenticated, setLocation]);

  if (isLoading) {
    return <div className="min-h-[100dvh] bg-background flex items-center justify-center">A carregar...</div>;
  }

  if (!isAuthenticated) return null;

  return (
    <AppLayout>
      <Component />
    </AppLayout>
  );
}

function PublicOnlyRoute({ component: Component, ...rest }: { component: any, path: string }) {
  const { isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      setLocation('/home');
    }
  }, [isLoading, isAuthenticated, setLocation]);

  if (isLoading) return <div className="min-h-[100dvh] bg-background flex items-center justify-center">A carregar...</div>;
  
  if (isAuthenticated) return null;

  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/">{(params) => <PublicOnlyRoute component={Landing} path="/" />}</Route>
      <Route path="/login">{(params) => <PublicOnlyRoute component={Login} path="/login" />}</Route>
      <Route path="/registo">{(params) => <PublicOnlyRoute component={Register} path="/registo" />}</Route>
      
      {/* Protected Routes */}
      <Route path="/onboarding">{(params) => <ProtectedRoute component={Onboarding} path="/onboarding" />}</Route>
      <Route path="/home">{(params) => <ProtectedRoute component={Home} path="/home" />}</Route>
      <Route path="/explorar">{(params) => <ProtectedRoute component={Explore} path="/explorar" />}</Route>
      <Route path="/reels">{(params) => <ProtectedRoute component={Reels} path="/reels" />}</Route>
      <Route path="/mensagens">{(params) => <ProtectedRoute component={MessagesList} path="/mensagens" />}</Route>
      <Route path="/mensagens/:id">{(params) => <ProtectedRoute component={MessageThread} path="/mensagens/:id" />}</Route>
      <Route path="/notificacoes">{(params) => <ProtectedRoute component={Notifications} path="/notificacoes" />}</Route>
      <Route path="/perfil/:username">{(params) => <ProtectedRoute component={Profile} path="/perfil/:username" />}</Route>
      <Route path="/definicoes">{(params) => <ProtectedRoute component={Settings} path="/definicoes" />}</Route>
      <Route path="/definicoes/monetizacao">{(params) => <ProtectedRoute component={Monetization} path="/definicoes/monetizacao" />}</Route>
      
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <AuthProvider>
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;