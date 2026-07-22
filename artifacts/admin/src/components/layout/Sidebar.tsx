import { Link, useLocation } from 'wouter';
import { 
  LayoutDashboard, Users, Star, ShieldCheck, Image as ImageIcon, 
  Flag, TrendingUp, Wallet, Bell, Settings, ClipboardList,
  PanelLeftClose, PanelLeftOpen
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  isMobile?: boolean;
}

export function Sidebar({ collapsed, onToggle, isMobile = false }: SidebarProps) {
  const [location] = useLocation();

  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/users', label: 'Utilizadores', icon: Users },
    { href: '/creators', label: 'Criadores', icon: Star },
    { href: '/creators/kyc', label: 'Fila KYC', icon: ShieldCheck, badge: 12 },
    { href: '/content', label: 'Conteúdo', icon: ImageIcon },
    { href: '/reports', label: 'Denúncias', icon: Flag, badge: 28 },
    { href: '/finance', label: 'Financeiro', icon: TrendingUp },
    { href: '/withdrawals', label: 'Levantamentos', icon: Wallet, badge: 5 },
    { href: '/broadcast', label: 'Broadcast', icon: Bell },
    { href: '/settings', label: 'Definições', icon: Settings },
    { href: '/audit-log', label: 'Audit Log', icon: ClipboardList },
  ];

  return (
    <div className="flex flex-col h-full bg-[hsl(var(--sidebar))]">
      <div className={cn("flex items-center h-16 border-b border-border px-4", collapsed ? "justify-center" : "justify-between")}>
        {!collapsed && (
          <Link href="/dashboard" className="flex items-center gap-1 font-bold text-xl tracking-tight transition-opacity hover:opacity-80">
            <span className="text-primary">X</span>
            <span className="text-white">clusive</span>
            <span className="text-xs text-muted-foreground ml-2 font-mono">ADMIN</span>
          </Link>
        )}
        {collapsed && (
          <div className="text-primary font-bold text-xl">X</div>
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
                  
                  {!collapsed && item.badge && (
                    <span className="ml-auto flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary border border-primary/30">
                      {item.badge}
                    </span>
                  )}
                  {collapsed && item.badge && (
                    <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary"></span>
                  )}
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
