import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

const FEATURED_CREATORS = [
  { id: 1, name: 'Sofia Costa', username: '@sofiacosta', niche: 'Moda', subs: '12k', avatar: 'https://i.pravatar.cc/150?u=1' },
  { id: 2, name: 'Miguel Silva', username: '@miguel_s', niche: 'Fitness', subs: '8.5k', avatar: 'https://i.pravatar.cc/150?u=2' },
  { id: 3, name: 'Ana Santos', username: '@anasantos.art', niche: 'Arte', subs: '24k', avatar: 'https://i.pravatar.cc/150?u=3' },
  { id: 4, name: 'Pedro Alves', username: '@pedro_beats', niche: 'Música', subs: '5.2k', avatar: 'https://i.pravatar.cc/150?u=4' },
];

const HOW_IT_WORKS = [
  {
    step: '01',
    title: 'Cria a tua conta',
    description: 'Regista-te gratuitamente em segundos. Sem cartão de crédito obrigatório.',
  },
  {
    step: '02',
    title: 'Publica o teu conteúdo',
    description: 'Fotos, vídeos, áudio, texto — publica o que quiseres para os teus fãs.',
  },
  {
    step: '03',
    title: 'Recebe diretamente',
    description: 'Os teus fãs subscrevem e os pagamentos chegam diretamente a ti. Sem esperas.',
  },
];

const BENEFITS = [
  {
    icon: '💰',
    title: 'Monetização direta',
    description: 'Recebe o pagamento dos teus fãs diretamente, via Multicaixa Express ou referência bancária angolana. Sem intermediários que fiquem com a maior parte.',
  },
  {
    icon: '📱',
    title: 'Conteúdo exclusivo',
    description: 'Publica conteúdo só para os teus subscritores. Fotos, vídeos, lives, mensagens privadas — tudo numa só plataforma.',
  },
  {
    icon: '🇦🇴',
    title: 'Feito para Angola',
    description: 'A única plataforma de creator economy criada especificamente para criadores e fãs angolanos. Kwanzas, Multicaixa e suporte local.',
  },
  {
    icon: '🔒',
    title: 'Controlo total',
    description: 'Tu defines os preços, o tipo de conteúdo e quem pode ver o quê. A tua criatividade, as tuas regras.',
  },
  {
    icon: '📊',
    title: 'Estatísticas em tempo real',
    description: 'Acompanha o crescimento da tua audiência, receitas e engagement com dashboards detalhados.',
  },
  {
    icon: '🎯',
    title: 'Comunidade engajada',
    description: 'Constrói uma relação genuína com os teus fãs através de mensagens diretas, comentários e lives exclusivas.',
  },
];

const FAQ_ITEMS = [
  {
    q: 'O que é o Xclusive?',
    a: 'O Xclusive é a primeira plataforma angolana de conteúdo exclusivo. Criadores publicam conteúdo para os seus fãs pagantes e recebem diretamente, sem intermediários.',
  },
  {
    q: 'Como funciona a monetização?',
    a: 'Defines um preço de subscripção mensal. Os teus fãs pagam via Multicaixa Express ou referência bancária e têm acesso ao teu conteúdo exclusivo. Tu recebes o valor na tua carteira Xclusive.',
  },
  {
    q: 'O Xclusive aceita pagamentos em Kwanza?',
    a: 'Sim! O Xclusive foi desenvolvido de raiz para Angola e aceita pagamentos em Kwanza (AOA) através de Multicaixa Express e referências bancárias angolanas.',
  },
  {
    q: 'Posso começar como fã e depois tornar-me criador?',
    a: 'Absolutamente. Qualquer conta pode ser atualizada para criador a qualquer momento, bastando completar a verificação de identidade.',
  },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">

      {/* ── Navigation ── */}
      <nav
        aria-label="Navegação principal"
        className="fixed top-0 left-0 right-0 h-16 border-b border-border bg-background/80 backdrop-blur-md z-50 flex items-center justify-between px-4 sm:px-6 lg:px-12"
      >
        <Link href="/">
          <img src="/logo.png" alt="Xclusive — Plataforma de conteúdo exclusivo em Angola" className="h-7 w-auto object-contain cursor-pointer drop-shadow" width="120" height="28" />
        </Link>
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

      <main className="flex-1 mt-16 flex flex-col" id="main-content">

        {/* ── Hero Section ── */}
        <section
          aria-labelledby="hero-heading"
          className="flex flex-col items-center justify-center text-center px-4 sm:px-6 py-16 sm:py-24 lg:py-32"
          itemScope
          itemType="https://schema.org/WPHeader"
        >
          <div className="bg-secondary text-primary font-bold text-xs uppercase tracking-wider px-4 py-1.5 rounded-full mb-8 border border-border" aria-label="Destaque">
            Sem intermediários. Feito em Angola.
          </div>

          <h1
            id="hero-heading"
            className="text-3xl sm:text-5xl lg:text-7xl font-extrabold tracking-tight mb-6 max-w-4xl"
          >
            Conteúdo exclusivo.<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-[#ff8a5c] to-[#ffc93e]">
              Ganhos diretos.
            </span>
          </h1>

          <p className="text-base sm:text-lg lg:text-xl text-muted-foreground max-w-2xl mb-4">
            A plataforma onde criadores angolanos e os seus fãs se conectam sem filtros.
          </p>
          <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mb-10">
            Monetiza o teu conteúdo em Kwanzas, constrói a tua comunidade e fica com o que é teu — diretamente via Multicaixa Express.
          </p>

          <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">
            <Link href="/registo" className="w-full sm:w-auto">
              <Button
                className="w-full sm:w-auto h-14 px-8 bg-primary hover:bg-primary/90 text-white text-lg font-bold rounded-full shadow-[0_0_30px_rgba(255,62,114,0.3)]"
                aria-label="Criar conta gratuita no Xclusive e começar a criar conteúdo"
              >
                Começar a criar — é grátis
              </Button>
            </Link>
            <Link href="/explorar" className="w-full sm:w-auto">
              <Button
                variant="outline"
                className="w-full sm:w-auto h-14 px-8 text-lg font-bold rounded-full border-border hover:bg-secondary"
                aria-label="Explorar criadores na plataforma Xclusive"
              >
                Explorar criadores
              </Button>
            </Link>
          </div>

          {/* Social proof numbers */}
          <div className="flex flex-wrap justify-center gap-8 mt-16 text-center" aria-label="Estatísticas da plataforma">
            <div>
              <span className="block text-3xl font-extrabold text-foreground">+2.400</span>
              <span className="text-sm text-muted-foreground">Criadores ativos</span>
            </div>
            <div className="w-px h-12 bg-border hidden sm:block self-center" />
            <div>
              <span className="block text-3xl font-extrabold text-foreground">+18.000</span>
              <span className="text-sm text-muted-foreground">Fãs registados</span>
            </div>
            <div className="w-px h-12 bg-border hidden sm:block self-center" />
            <div>
              <span className="block text-3xl font-extrabold text-foreground">100% AO</span>
              <span className="text-sm text-muted-foreground">Pagamentos em Kwanza</span>
            </div>
          </div>
        </section>

        {/* ── Featured Creators ── */}
        <section
          aria-labelledby="creators-heading"
          className="px-4 sm:px-6 lg:px-12 py-12 sm:py-16 bg-secondary/30"
          itemScope
          itemType="https://schema.org/ItemList"
        >
          <div className="max-w-6xl mx-auto">
            <div className="flex items-center justify-between mb-6 sm:mb-10">
              <h2 id="creators-heading" className="text-2xl sm:text-3xl font-bold">
                Criadores em destaque
              </h2>
              <Link href="/explorar" className="text-primary hover:underline font-semibold" aria-label="Ver todos os criadores no Xclusive">
                Ver todos
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {FEATURED_CREATORS.map((creator, index) => (
                <article
                  key={creator.id}
                  className="bg-card border border-border rounded-2xl p-6 flex flex-col items-center text-center hover:border-primary/50 transition-colors group cursor-pointer"
                  itemScope
                  itemType="https://schema.org/Person"
                  itemProp="itemListElement"
                  aria-label={`Perfil do criador ${creator.name}, especializado em ${creator.niche}`}
                >
                  <meta itemProp="position" content={String(index + 1)} />
                  <Avatar className="w-24 h-24 mb-4 border-2 border-transparent group-hover:border-primary transition-colors">
                    <AvatarImage src={creator.avatar} alt={`Foto de perfil de ${creator.name}, criador de conteúdo de ${creator.niche} no Xclusive Angola`} />
                    <AvatarFallback>{creator.name[0]}</AvatarFallback>
                  </Avatar>
                  <h3 className="font-bold text-lg" itemProp="name">{creator.name}</h3>
                  <p className="text-muted-foreground text-sm mb-4" itemProp="alternateName">{creator.username}</p>
                  <div className="flex items-center justify-center gap-4 w-full pt-4 border-t border-border/50">
                    <div className="text-center">
                      <span className="block font-bold text-foreground" aria-label={`${creator.subs} fãs`}>{creator.subs}</span>
                      <span className="text-[10px] text-muted-foreground uppercase">Fãs</span>
                    </div>
                    <div className="w-px h-8 bg-border/50" />
                    <div className="text-center">
                      <span className="block font-bold text-foreground" itemProp="knowsAbout">{creator.niche}</span>
                      <span className="text-[10px] text-muted-foreground uppercase">Nicho</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── How It Works ── */}
        <section
          aria-labelledby="how-heading"
          className="px-4 sm:px-6 lg:px-12 py-16 sm:py-24"
        >
          <div className="max-w-4xl mx-auto">
            <h2 id="how-heading" className="text-2xl sm:text-3xl font-bold text-center mb-4">
              Como funciona o Xclusive
            </h2>
            <p className="text-center text-muted-foreground mb-12 max-w-xl mx-auto">
              Em três passos simples, começas a monetizar o teu conteúdo e a construir a tua comunidade em Angola.
            </p>
            <ol className="grid grid-cols-1 sm:grid-cols-3 gap-8" aria-label="Passos para começar no Xclusive">
              {HOW_IT_WORKS.map((item) => (
                <li key={item.step} className="flex flex-col items-center text-center">
                  <span className="text-5xl font-extrabold text-primary/20 mb-4" aria-hidden="true">{item.step}</span>
                  <h3 className="text-lg font-bold mb-2">{item.title}</h3>
                  <p className="text-muted-foreground text-sm">{item.description}</p>
                </li>
              ))}
            </ol>
            <div className="text-center mt-12">
              <Link href="/registo">
                <Button
                  className="h-12 px-8 bg-primary hover:bg-primary/90 text-white font-bold rounded-full"
                  aria-label="Criar conta gratuita no Xclusive"
                >
                  Criar conta gratuita
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* ── Benefits / Features ── */}
        <section
          aria-labelledby="benefits-heading"
          className="px-4 sm:px-6 lg:px-12 py-16 sm:py-24 bg-secondary/20"
        >
          <div className="max-w-6xl mx-auto">
            <h2 id="benefits-heading" className="text-2xl sm:text-3xl font-bold text-center mb-4">
              Tudo o que precisas para crescer em Angola
            </h2>
            <p className="text-center text-muted-foreground mb-12 max-w-2xl mx-auto">
              O Xclusive foi construído de raiz para criadores angolanos. Ferramentas simples, pagamentos locais e suporte real.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {BENEFITS.map((benefit) => (
                <article
                  key={benefit.title}
                  className="bg-card border border-border rounded-2xl p-6 hover:border-primary/30 transition-colors"
                  aria-label={benefit.title}
                >
                  <div className="text-3xl mb-4" aria-hidden="true">{benefit.icon}</div>
                  <h3 className="font-bold text-lg mb-2">{benefit.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{benefit.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── FAQ Section ── */}
        <section
          aria-labelledby="faq-heading"
          className="px-4 sm:px-6 lg:px-12 py-16 sm:py-24"
          itemScope
          itemType="https://schema.org/FAQPage"
        >
          <div className="max-w-3xl mx-auto">
            <h2 id="faq-heading" className="text-2xl sm:text-3xl font-bold text-center mb-12">
              Perguntas frequentes
            </h2>
            <div className="flex flex-col gap-6">
              {FAQ_ITEMS.map((item) => (
                <div
                  key={item.q}
                  className="border border-border rounded-xl p-6"
                  itemScope
                  itemType="https://schema.org/Question"
                  itemProp="mainEntity"
                >
                  <h3 className="font-bold text-base mb-2" itemProp="name">{item.q}</h3>
                  <div itemScope itemType="https://schema.org/Answer" itemProp="acceptedAnswer">
                    <p className="text-muted-foreground text-sm leading-relaxed" itemProp="text">{item.a}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Final CTA ── */}
        <section
          aria-labelledby="cta-heading"
          className="px-4 sm:px-6 py-16 sm:py-24 text-center bg-gradient-to-b from-transparent to-secondary/30"
        >
          <h2 id="cta-heading" className="text-2xl sm:text-4xl font-extrabold mb-4">
            Pronto para começar a ganhar?
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto mb-8">
            Junta-te a mais de 2.400 criadores angolanos que já estão a monetizar o seu talento no Xclusive.
          </p>
          <Link href="/registo">
            <Button
              className="h-14 px-10 bg-primary hover:bg-primary/90 text-white text-lg font-bold rounded-full shadow-[0_0_40px_rgba(255,62,114,0.25)]"
              aria-label="Criar conta gratuita no Xclusive e começar a ganhar"
            >
              Criar conta — é grátis
            </Button>
          </Link>
          <p className="text-xs text-muted-foreground mt-4">Sem taxas de adesão. Cancela quando quiseres.</p>
        </section>

      </main>

      {/* ── Footer ── */}
      <footer
        role="contentinfo"
        aria-label="Rodapé do Xclusive"
        className="border-t border-border py-10 px-6 lg:px-12 mt-auto"
        itemScope
        itemType="https://schema.org/WPFooter"
      >
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row items-start justify-between gap-8 mb-8">
            <div className="flex flex-col gap-3 max-w-xs">
              <Link href="/">
                <img src="/logo.png" alt="Xclusive" className="h-6 w-auto object-contain cursor-pointer" width="100" height="24" />
              </Link>
              <p className="text-sm text-muted-foreground">
                A primeira plataforma angolana de conteúdo exclusivo. Monetiza o teu talento, cresce a tua comunidade.
              </p>
            </div>
            <nav aria-label="Links do rodapé" className="flex flex-wrap gap-x-8 gap-y-3">
              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold text-foreground uppercase tracking-wide mb-1">Plataforma</span>
                <Link href="/explorar" className="text-sm text-muted-foreground hover:text-primary transition-colors">Explorar criadores</Link>
                <Link href="/registo" className="text-sm text-muted-foreground hover:text-primary transition-colors">Tornar-me criador</Link>
                <Link href="/login" className="text-sm text-muted-foreground hover:text-primary transition-colors">Entrar na conta</Link>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold text-foreground uppercase tracking-wide mb-1">Legal</span>
                <a href="#" className="text-sm text-muted-foreground hover:text-primary transition-colors">Termos de uso</a>
                <a href="#" className="text-sm text-muted-foreground hover:text-primary transition-colors">Política de privacidade</a>
                <a href="#" className="text-sm text-muted-foreground hover:text-primary transition-colors">Suporte</a>
              </div>
            </nav>
          </div>
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 pt-6 border-t border-border/50">
            <p className="text-sm text-muted-foreground">
              &copy; {new Date().getFullYear()} Xclusive. Todos os direitos reservados. Luanda, Angola.
            </p>
            <p className="text-xs text-muted-foreground">
              Pagamentos via Multicaixa Express &middot; Kwanza (AOA)
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}