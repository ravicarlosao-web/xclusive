import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import { useEffect } from 'react';
import { AdminAuthProvider, useAdminAuth } from '@/context/AdminAuthContext';
import { AdminLayout } from '@/components/layout/AdminLayout';

// Pages
import Login from '@/pages/login';
import Dashboard from '@/pages/dashboard';
import Users from '@/pages/users/index';
import UserDetail from '@/pages/users/[id]';
import Creators from '@/pages/creators/index';
import KycQueue from '@/pages/creators/kyc';
import Content from '@/pages/content/index';
import Reports from '@/pages/reports/index';
import Finance from '@/pages/finance/index';
import Withdrawals from '@/pages/withdrawals/index';
import Broadcast from '@/pages/broadcast/index';
import Settings from '@/pages/settings/index';
import AuditLog from '@/pages/audit-log/index';

const queryClient = new QueryClient();

function ProtectedRoute({ component: Component, ...rest }: any) {
  const { isAuthenticated, isInitialized } = useAdminAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (isInitialized && !isAuthenticated) {
      setLocation('/login');
    }
  }, [isAuthenticated, isInitialized, setLocation]);

  if (!isInitialized) return null;
  if (!isAuthenticated) return null;

  return <Component {...rest} />;
}

function RootRedirect() {
  const [, setLocation] = useLocation();
  useEffect(() => { setLocation('/dashboard'); }, [setLocation]);
  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/" component={RootRedirect} />
      <Route>
        <AdminLayout>
          <Switch>
            <Route path="/dashboard"><ProtectedRoute component={Dashboard} /></Route>
            <Route path="/users"><ProtectedRoute component={Users} /></Route>
            <Route path="/users/:id"><ProtectedRoute component={UserDetail} /></Route>
            <Route path="/creators"><ProtectedRoute component={Creators} /></Route>
            <Route path="/creators/kyc"><ProtectedRoute component={KycQueue} /></Route>
            <Route path="/content"><ProtectedRoute component={Content} /></Route>
            <Route path="/reports"><ProtectedRoute component={Reports} /></Route>
            <Route path="/finance"><ProtectedRoute component={Finance} /></Route>
            <Route path="/withdrawals"><ProtectedRoute component={Withdrawals} /></Route>
            <Route path="/broadcast"><ProtectedRoute component={Broadcast} /></Route>
            <Route path="/settings"><ProtectedRoute component={Settings} /></Route>
            <Route path="/audit-log"><ProtectedRoute component={AuditLog} /></Route>
            <Route>
              <div className="flex h-full items-center justify-center text-muted-foreground">
                Page not found
              </div>
            </Route>
          </Switch>
        </AdminLayout>
      </Route>
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
        <AdminAuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
          <Toaster />
        </AdminAuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
