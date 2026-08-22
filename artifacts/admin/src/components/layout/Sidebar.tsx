import { Link, useLocation } from 'wouter';
import { 
  LayoutDashboard, Users, Star, ShieldCheck, Image as ImageIcon, 
  Flag, TrendingUp, Wallet, Bell, Settings, ClipboardList,
  PanelLeftClose, PanelLeftOpen, ArrowDownToLine
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  isMobile?: boolean;
}

export function Sidebar({ collapsed, onToggle, isMobile = false }: SidebarProps) {
  const [location] = useLocation();

  const { data: kpis } = useQuery({
    queryKey: ['dashboard', 'kpis'],
    queryFn: adminApi.getDashboardKpis,
    refetchInterval: 30000,
    staleTime: 15000,
  });

  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/users', label: 'Utilizadores', icon: Users },
    { href: '/creators', label: 'Criadores', icon: Star },
    { href: '/creators/kyc', label: 'Fila KYC', icon: ShieldCheck, badge: kpis?.kycPendente || undefined },
    { href: '/content', label: 'Conteúdo', icon: ImageIcon },
    { href: '/reports', label: 'Denúncias', icon: Flag, badge: kpis?.denunciasPendentes || undefined },
    { href: '/finance', label: 'Financeiro', icon: TrendingUp },
    { href: '/topups', label: 'Carregamentos', icon: ArrowDownToLine },
    { href: '/withdrawals', label: 'Levantamentos', icon: Wallet, badge: kpis?.levantamentosPendentes || undefined },
    { href: '/broadcast', label: 'Broadcast', icon: Bell },
    { href: '/settings', label: 'Definições', icon: Settings },
    { href: '/audit-log', label: 'Audit Log', icon: ClipboardList },
  ];

  return (
    <div className="flex flex-col h-full bg-[hsl(var(--sidebar))]">
      <div className={cn("flex items-center h-16 border-b border-border px-4", collapsed ? "justify-center" : "justify-between")}>
        {!collapsed ? (
          <Link href="/dashboard" className="flex items-center gap-2 transition-opacity hover:opacity-80">
            <img src="/logo.png" alt="Xclusive" className="h-6 w-auto object-contain drop-shadow" />
            <span className="text-[10px] text-primary ml-1 px-1.5 py-0.5 rounded bg-primary/10 font-mono font-extrabold border border-primary/20">ADMIN</span>
          </Link>
        ) : (
          <div className="w-6 h-6 overflow-hidden flex items-center justify-start">
            <img src="/logo.png" alt="Xclusive" className="h-6 max-w-none object-contain drop-shadow" />
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-4 px-2 custom-scrollbar">
        <nav className="space-y-1">
          {navItems.map((item) => {
            const isActive = location.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={cn(
                    "flex items-center rounded-md px-3 py-2 text-sm font-medium transition-all group cursor-pointer",
                    isActive 
                      ? "bg-primary/10 text-primary border border-primary/20" 
                      : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground border border-transparent",
                    collapsed && "justify-center px-0"
                  )}
                  title={collapsed ? item.label : undefined}
                >
                  <item.icon className={cn("h-5 w-5", !collapsed && "mr-3", isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
                  {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                  
                  {!collapsed && item.badge ? (
                    <span className="ml-auto flex h-5 min-w-5 px-1 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary border border-primary/30">
                      {item.badge}
                    </span>
                  ) : null}
                  {collapsed && item.badge ? (
                    <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary"></span>
                  ) : null}
                </div>
              </Link>
            );
          })}
        </nav>
      </div>

      {!isMobile && (
        <div className="p-3 border-t border-border">
          <Button 
            variant="ghost" 
            size="sm" 
            className="w-full flex justify-center text-muted-foreground hover:text-foreground"
            onClick={onToggle}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </Button>
        </div>
      )}
    </div>
  );
}
