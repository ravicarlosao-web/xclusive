import type { ReactNode } from 'react';

/** Logo da versão telemóvel/tablet (< lg): fica no topo do conteúdo, centrado. A coluna esquerda só existe a partir de lg. */
export function AuthLogoMobile() {
  return (
    <div className="lg:hidden flex items-center justify-center mb-6">
      {/* Dois logos trocados por tema: o escuro (palavra branca) só no modo noturno, o claro (palavra escura) só no diurno */}
      <img src="/logo.png" alt="Xclusive" className="hidden dark:block h-9 w-auto object-contain drop-shadow" />
      <img src="/logo-claro.png" alt="Xclusive" className="dark:hidden h-9 w-auto object-contain" />
    </div>
  );
}

/** Cabeçalho das páginas de autenticação: centrado no telemóvel, alinhado à esquerda no desktop. */
export function AuthHeader({ titulo, subtitulo }: { titulo: string; subtitulo: string }) {
  return (
    <div className="text-center lg:text-left mb-10">
      <AuthLogoMobile />
      <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2">{titulo}</h1>
      <p className="text-muted-foreground">{subtitulo}</p>
    </div>
  );
}

/**
 * Layout em duas colunas das páginas de autenticação (login e registo).
 * - Desktop (≥ lg): coluna esquerda com logo + frase, coluna direita com o conteúdo.
 * - Telemóvel/tablet (< lg): só a coluna do conteúdo, centrada.
 * `centroFixo`: para conteúdos altos (registo) — o logo e a frase ficam centrados no ecrã (sticky) enquanto a página faz scroll.
 */
export function AuthSplitLayout({ frase, centroFixo = false, children }: { frase: string; centroFixo?: boolean; children: ReactNode }) {
  const marca = (
    <div className="relative z-20 flex flex-col items-center text-center p-12">
      {/* Brilho rosa só no modo noturno; no diurno o logo claro fica sem brilho */}
      <img
        src="/logo.png"
        alt="Xclusive"
        className="hidden dark:block h-16 w-auto object-contain mb-8 drop-shadow-[0_0_35px_rgba(255,59,92,0.4)]"
      />
      <img src="/logo-claro.png" alt="Xclusive" className="dark:hidden h-16 w-auto object-contain mb-8" />
      <p className="text-xl text-gray-600 dark:text-gray-300 max-w-md font-medium">{frase}</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-background flex">
      {/* Left side - Image/Branding */}
      <div
        className={
          centroFixo
            ? 'hidden lg:flex lg:w-1/2 relative bg-secondary overflow-clip items-start justify-center'
            : 'hidden lg:flex lg:w-1/2 relative bg-secondary overflow-hidden items-center justify-center'
        }
      >
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-background to-background z-10" />
        {/* A foto com mistura "overlay" só no modo noturno; no diurno o painel fica só com o gradiente */}
        <div className="hidden dark:block absolute inset-0 bg-[url('https://images.unsplash.com/photo-1616469829581-73993eb86b02?q=80&w=2070&auto=format&fit=crop')] bg-cover bg-center opacity-30 mix-blend-overlay" />

        {centroFixo ? (
          <div className="relative z-20 sticky top-0 h-screen w-full flex items-center justify-center">{marca}</div>
        ) : (
          marca
        )}
      </div>

      {/* Right side - Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md space-y-8">{children}</div>
      </div>
    </div>
  );
}
