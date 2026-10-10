import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';

/**
 * Barreira 18+ para visitantes SEM sessão (plataforma de conteúdo adulto).
 * A escolha fica em localStorage (em try/catch: sem armazenamento, o aviso volta a aparecer a cada visita).
 * É uma barreira de ecrã; a idade real é validada no servidor no registo.
 * As páginas legais ficam acessíveis sem passar pelo aviso.
 */
const STORAGE_KEY = 'xclusive_idade_18';
const PATHS_SEM_BARREIRA = ['/termos', '/privacidade', '/politica-de-conteudo', '/direitos-de-autor', '/reembolsos'];

function lerEscolha(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}
function guardarEscolha(): void {
  try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* sem armazenamento: vale só nesta visita */ }
}

export function AgeGate() {
  const { isAuthenticated, isLoading } = useAuth();
  const [location] = useLocation();
  const [confirmado, setConfirmado] = useState<boolean>(lerEscolha);
  const botaoRef = useRef<HTMLButtonElement>(null);

  const visivel = !isLoading && !isAuthenticated && !confirmado && !PATHS_SEM_BARREIRA.includes(location);

  useEffect(() => {
    if (visivel) botaoRef.current?.focus();
  }, [visivel]);

  if (!visivel) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="age-gate-title"
      data-testid="age-gate"
      className="fixed inset-0 z-[100] bg-background flex items-center justify-center p-6"
    >
      <div className="max-w-md w-full text-center space-y-6">
        <img src="/logo.png" alt="Xclusive" className="h-8 w-auto mx-auto" />
        <div className="space-y-2">
          <h1 id="age-gate-title" className="text-2xl font-bold">Conteúdo para maiores de 18 anos</h1>
          <p className="text-sm text-muted-foreground">
            O Xclusive contém conteúdo para adultos. Confirma que tens 18 anos ou mais para continuar.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <Button ref={botaoRef} className="flex-1 h-12 font-bold rounded-xl" onClick={() => { guardarEscolha(); setConfirmado(true); }}>
            Tenho 18 anos ou mais
          </Button>
          <Button variant="outline" className="flex-1 h-12 rounded-xl" onClick={() => window.location.assign('https://www.google.com')}>
            Sair
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Ao continuar, aceitas que és maior de idade na tua jurisdição.
        </p>
      </div>
    </div>
  );
}
