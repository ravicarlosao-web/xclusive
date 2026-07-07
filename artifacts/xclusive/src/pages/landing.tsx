import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

const FEATURED_CREATORS = [
  { id: 1, name: 'Sofia Costa', username: '@sofiacosta', niche: 'Moda', subs: '12k', avatar: 'https://i.pravatar.cc/150?u=1' },
  { id: 2, name: 'Miguel Silva', username: '@miguel_s', niche: 'Fitness', subs: '8.5k', avatar: 'https://i.pravatar.cc/150?u=2' },
  { id: 3, name: 'Ana Santos', username: '@anasantos.art', niche: 'Arte', subs: '24k', avatar: 'https://i.pravatar.cc/150?u=3' },
  { id: 4, name: 'Pedro Alves', username: '@pedro_beats', niche: 'Música', subs: '5.2k', avatar: 'https://i.pravatar.cc/150?u=4' },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 h-16 border-b border-border bg-background/80 backdrop-blur-md z-50 flex items-center justify-between px-6 lg:px-12">
        <div className="text-2xl font-extrabold tracking-tighter">
          <span className="text-primary">X</span>
          <span className="text-white">clusive</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/login">
            <Button variant="ghost" className="font-semibold text-white hover:text-primary transition-colors">
              Entrar
            </Button>
          </Link>
          <Link href="/registo">
            <Button className="bg-primary hover:bg-primary/90 text-white font-semibold rounded-full px-6">
              Criar conta
            </Button>
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <main className="flex-1 mt-16 flex flex-col">
        <section className="flex flex-col items-center justify-center text-center px-4 py-24 lg:py-32">
          <div className="bg-secondary text-primary font-bold text-xs uppercase tracking-wider px-4 py-1.5 rounded-full mb-8 border border-border">
            Sem intermediários.
          </div>
          <h1 className="text-5xl lg:text-7xl font-extrabold tracking-tight mb-6 max-w-4xl">
            Conteúdo exclusivo.<br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-[#ff8a5c] to-[#ffc93e]">
              Ganhos diretos.
            </span>
          </h1>
          <p className="text-lg lg:text-xl text-muted-foreground max-w-2xl mb-10">
            A plataforma onde criadores e fãs se conectam sem filtros. Monetiza o teu conteúdo, constrói a tua comunidade e fica com o que é teu.
          </p>
          <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">
            <Link href="/registo" className="w-full sm:w-auto">
              <Button className="w-full sm:w-auto h-14 px-8 bg-primary hover:bg-primary/90 text-white text-lg font-bold rounded-full shadow-[0_0_30px_rgba(255,62,114,0.3)]">
                Começar a criar
              </Button>
            </Link>
            <Link href="/explorar" className="w-full sm:w-auto">
              <Button variant="outline" className="w-full sm:w-auto h-14 px-8 text-lg font-bold rounded-full border-border hover:bg-secondary">
                Explorar plataforma
              </Button>
            </Link>
          </div>
        </section>

        {/* Featured Creators */}
        <section className="px-6 lg:px-12 py-16 bg-secondary/30">
          <div className="max-w-6xl mx-auto">
            <div className="flex items-center justify-between mb-10">
              <h2 className="text-3xl font-bold">Criadores em destaque</h2>
              <Link href="/explorar" className="text-primary hover:underline font-semibold">Ver todos</Link>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {FEATURED_CREATORS.map((creator) => (
                <div key={creator.id} className="bg-card border border-border rounded-2xl p-6 flex flex-col items-center text-center hover:border-primary/50 transition-colors group cursor-pointer">
                  <Avatar className="w-24 h-24 mb-4 border-2 border-transparent group-hover:border-primary transition-colors">
                    <AvatarImage src={creator.avatar} />
                    <AvatarFallback>{creator.name[0]}</AvatarFallback>
                  </Avatar>
                  <h3 className="font-bold text-lg">{creator.name}</h3>
                  <p className="text-muted-foreground text-sm mb-4">{creator.username}</p>
                  <div className="flex items-center justify-center gap-4 w-full pt-4 border-t border-border/50">
                    <div className="text-center">
                      <span className="block font-bold text-foreground">{creator.subs}</span>
                      <span className="text-[10px] text-muted-foreground uppercase">Fãs</span>
                    </div>
                    <div className="w-px h-8 bg-border/50" />
                    <div className="text-center">
                      <span className="block font-bold text-foreground">{creator.niche}</span>
                      <span className="text-[10px] text-muted-foreground uppercase">Nicho</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-6 lg:px-12 mt-auto">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="text-xl font-extrabold tracking-tighter">
            <span className="text-primary">X</span>clusive
          </div>
          <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
            <a href="#" className="hover:text-primary transition-colors">Sobre</a>
            <a href="#" className="hover:text-primary transition-colors">Termos</a>
            <a href="#" className="hover:text-primary transition-colors">Privacidade</a>
            <a href="#" className="hover:text-primary transition-colors">Suporte</a>
          </div>
          <div className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} Xclusive.
          </div>
        </div>
      </footer>
    </div>
  );
}