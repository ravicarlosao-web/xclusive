import { Link, useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { 
  Home, Compass, Play, Mail, Heart, PlusSquare, BarChart, 
  Menu, LogOut, Settings, User as UserIcon, Sparkles, Wallet
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { ReactNode, useState } from 'react';
import { CreatePostModal } from '@/components/shared/CreatePostModal';

export function AppLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user, logout, saldo } = useAuth();
  const [createPostOpen, setCreatePostOpen] = useState(false);

  const navItems = [
    { name: 'Início', path: '/home', icon: Home },
    { name: 'Explorar', path: '/explorar', icon: Compass },
    { name: 'Reels', path: '/reels', icon: Play },
    { name: 'Mensagens', path: '/mensagens', icon: Mail, badge: 2 }, // mocked badge
    { name: 'Notificações', path: '/notificacoes', icon: Heart, badge: 5 }, // mocked badge
  ];

  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex">
      {/* Desktop & Tablet Sidebar */}
      <aside className="hidden md:flex flex-col fixed left-0 top-0 bottom-0 z-50 w-[80px] lg:w-[245px] border-r border-border bg-card transition-all duration-300">
        <div className="p-4 lg:p-6 mb-2">
          <Link href="/home" className="flex items-center gap-2">
            <span className="text-2xl font-extrabold tracking-tighter">
              <span className="text-primary">X</span>
              <span className="hidden lg:inline text-white">clusive</span>
            </span>
          </Link>
        </div>

        <nav className="flex-1 flex flex-col gap-2 px-3 lg:px-4">
          {navItems.map((item) => {
            const isActive = location.startsWith(item.path);
            return (
              <Link key={item.path} href={item.path}>
                <div className={cn(
                  "flex items-center gap-4 p-3 rounded-xl transition-all duration-200 cursor-pointer group hover:bg-secondary",
                  isActive ? "text-primary font-semibold" : "text-foreground"
                )}>
                  <div className="relative">
                    <item.icon className={cn("w-6 h-6", isActive ? "stroke-[2.5px]" : "stroke-[1.5px] group-hover:scale-110 transition-transform")} />
                    {item.badge && (
                      <span className="absolute -top-1.5 -right-1.5 bg-primary text-white text-[10px] font-bold px-1.5 min-w-[18px] h-[18px] rounded-full flex items-center justify-center border-2 border-card">
                        {item.badge}
                      </span>
                    )}
                  </div>
                  <span className="hidden lg:block text-[15px]">{item.name}</span>
                </div>
              </Link>
            );
          })}

          <button
            onClick={() => setCreatePostOpen(true)}
            className="flex items-center gap-4 p-3 rounded-xl transition-all duration-200 cursor-pointer group hover:bg-secondary text-foreground text-left w-full"
          >
            <PlusSquare className="w-6 h-6 stroke-[1.5px] group-hover:scale-110 transition-transform" />
            <span className="hidden lg:block text-[15px]">Criar</span>
          </button>

          <Link href={user ? `/perfil/${user.username}` : '/login'}>
            <div className={cn(
              "flex items-center gap-4 p-3 rounded-xl transition-all duration-200 cursor-pointer group hover:bg-secondary",
              location.startsWith('/perfil') ? "text-primary font-semibold" : "text-foreground"
            )}>
              <Avatar className="w-6 h-6 border border-border group-hover:scale-110 transition-transform">
                <AvatarImage src={user?.avatarUrl || ''} />
                <AvatarFallback className="bg-secondary text-[10px]"><UserIcon className="w-4 h-4" /></AvatarFallback>
              </Avatar>
              <span className="hidden lg:block text-[15px]">Perfil</span>
            </div>
          </Link>

          {user?.tipoConta === 'criador' ? (
            <Link href="/definicoes/monetizacao">
              <div className={cn(
                "flex items-center gap-4 p-3 rounded-xl transition-all duration-200 cursor-pointer group hover:bg-secondary",
                location.startsWith('/definicoes/monetizacao') ? "text-primary font-semibold" : "text-foreground"
              )}>
                <BarChart className={cn("w-6 h-6", location.startsWith('/definicoes/monetizacao') ? "stroke-[2.5px]" : "stroke-[1.5px] group-hover:scale-110 transition-transform")} />
                <span className="hidden lg:block text-[15px]">Painel Criador</span>
              </div>
            </Link>
          ) : (
            <Link href="/tornar-criador">
              <div className={cn(
                "flex items-center gap-4 p-3 rounded-xl transition-all duration-200 cursor-pointer group hover:bg-primary/10 border border-transparent hover:border-primary/30",
                location.startsWith('/tornar-criador') ? "text-primary font-semibold bg-primary/10 border-primary/30" : "text-primary/70"
              )}>
                <Sparkles className="w-6 h-6 stroke-[1.5px] group-hover:scale-110 transition-transform" />
                <span className="hidden lg:block text-[14px] font-semibold">Tornar-se Criador</span>
              </div>
            </Link>
          )}
        </nav>

        <div className="p-3 lg:p-4 mt-auto flex flex-col gap-2">
          {/* Carteira / Saldo */}
          {saldo !== null && (
            <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-secondary/50 border border-border/50">
              <Wallet className="w-5 h-5 text-yellow-500 stroke-[1.5px] shrink-0" />
              <div className="hidden lg:flex flex-col leading-tight">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Carteira</span>
                <span className="text-sm font-bold">{saldo.toLocaleString('pt-PT')} Kz</span>
              </div>
            </div>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <button className="flex items-center gap-4 p-3 rounded-xl transition-all duration-200 cursor-pointer group hover:bg-secondary w-full">
                <Menu className="w-6 h-6 stroke-[1.5px] group-hover:scale-110 transition-transform" />
                <span className="hidden lg:block text-[15px]">Mais</span>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-2 rounded-xl border-border bg-card shadow-2xl mb-2" side="top" align="start">
              <div className="flex flex-col gap-1">
                <Link href="/definicoes">
                  <Button variant="ghost" className="w-full justify-start gap-3 rounded-lg h-11 px-3">
                    <Settings className="w-5 h-5" /> Definições
                  </Button>
                </Link>
                <div className="h-px bg-border my-1" />
                <Button variant="ghost" className="w-full justify-start gap-3 rounded-lg h-11 px-3 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={logout}>
                  <LogOut className="w-5 h-5" /> Terminar sessão
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 md:ml-[80px] lg:ml-[245px] pb-[60px] md:pb-0 w-full min-h-[100dvh]">
        {children}
      </main>

      <CreatePostModal open={createPostOpen} onClose={() => setCreatePostOpen(false)} />

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-[60px] bg-card border-t border-border z-50 flex items-center justify-around px-2">
        {navItems.slice(0, 4).map((item) => {
          const isActive = location.startsWith(item.path);
          return (
            <Link key={item.path} href={item.path} className="p-2 relative">
              <item.icon className={cn("w-6 h-6 transition-transform", isActive ? "stroke-[2.5px] text-primary" : "stroke-[1.5px] text-foreground")} />
              {item.badge && (
                <span className="absolute top-1.5 right-1.5 bg-primary text-white text-[9px] font-bold px-1 min-w-[14px] h-[14px] rounded-full flex items-center justify-center border border-card">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
        <Link href={user ? `/perfil/${user.username}` : '/login'} className="p-2">
          <Avatar className={cn("w-6 h-6 transition-transform", location.startsWith('/perfil') ? "ring-2 ring-primary ring-offset-2 ring-offset-card" : "")}>
            <AvatarImage src={user?.avatarUrl || ''} />
            <AvatarFallback className="bg-secondary"><UserIcon className="w-4 h-4" /></AvatarFallback>
          </Avatar>
        </Link>
      </nav>
    </div>
  );
}