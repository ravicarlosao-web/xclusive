import { useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export type PreferenciaMais18 = 'ver' | 'filtrar';

/** Depois de mudar a preferência, o conteúdo já carregado (feed, explorar, stories, lives…) tem de ser lido de novo. */
export function invalidarConteudoMais18(queryClient: QueryClient) {
  queryClient.invalidateQueries({
    predicate: (q) => {
      const k = q.queryKey[0];
      return typeof k === 'string' && /^\/api\/(feed|explore|reels|stories|live|posts|users|search)/.test(k);
    },
  });
  queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
}

/** Guarda a escolha (PATCH /api/users/me/preferencia-mais18) e atualiza a conta e o conteúdo carregado. */
export function useGuardarPreferenciaMais18() {
  const queryClient = useQueryClient();
  const [aGuardar, setAGuardar] = useState(false);

  const guardar = async (valor: PreferenciaMais18, confirmo?: boolean) => {
    setAGuardar(true);
    try {
      const r = await customFetch<{ preferenciaMais18: PreferenciaMais18; preferenciaMais18Em: string | null }>(
        '/api/users/me/preferencia-mais18',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(valor === 'ver' ? { valor, confirmo: confirmo === true } : { valor }),
        },
      );
      // Atualiza já a conta em memória (o cartão não volta a aparecer) e depois relê tudo.
      queryClient.setQueryData(['/api/auth/me'], (antigo: unknown) =>
        antigo && typeof antigo === 'object'
          ? { ...(antigo as object), preferenciaMais18: r.preferenciaMais18, preferenciaMais18Em: r.preferenciaMais18Em }
          : antigo);
      invalidarConteudoMais18(queryClient);
      return r;
    } finally {
      setAGuardar(false);
    }
  };

  return { guardar, aGuardar };
}

/**
 * As duas opções: "filtrar" em destaque e "tenho 18+ e quero ver" (com confirmação explícita).
 * Usado pelo cartão inicial e pelas Definições (e pode ser reutilizado no onboarding).
 */
export function Mais18Opcoes({ atual, onGuardado }: { atual: PreferenciaMais18 | null; onGuardado?: (v: PreferenciaMais18) => void }) {
  const { guardar, aGuardar } = useGuardarPreferenciaMais18();
  const { toast } = useToast();
  const [passo, setPasso] = useState<'escolha' | 'confirmar'>('escolha');
  const [confirmo, setConfirmo] = useState(false);

  const executar = async (valor: PreferenciaMais18) => {
    try {
      await guardar(valor, valor === 'ver' ? confirmo : undefined);
      setPasso('escolha');
      setConfirmo(false);
      onGuardado?.(valor);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Não foi possível guardar a escolha', description: e?.data?.error || e?.message || 'Tenta novamente.' });
    }
  };

  if (passo === 'confirmar') {
    return (
      <div className="space-y-4" data-testid="mais18-confirmar-passo">
        <label className="flex items-start gap-3 text-sm cursor-pointer">
          <Checkbox checked={confirmo} onCheckedChange={(c) => setConfirmo(c === true)} data-testid="mais18-confirmo" className="mt-0.5" />
          <span>Confirmo que tenho 18 anos ou mais e quero ver conteúdo +18.</span>
        </label>
        <div className="flex flex-col-reverse sm:flex-row gap-2">
          <Button type="button" variant="outline" className="flex-1" disabled={aGuardar} onClick={() => { setPasso('escolha'); setConfirmo(false); }} data-testid="mais18-voltar">
            Voltar
          </Button>
          <Button type="button" className="flex-1" disabled={!confirmo || aGuardar} onClick={() => executar('ver')} data-testid="mais18-confirmar">
            {aGuardar && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Confirmar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-testid="mais18-opcoes">
      <Button type="button" size="lg" disabled={aGuardar || atual === 'filtrar'} onClick={() => executar('filtrar')} data-testid="mais18-filtrar">
        {aGuardar && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        Filtrar conteúdo +18 (recomendado){atual === 'filtrar' ? ' — atual' : ''}
      </Button>
      <Button type="button" variant="outline" disabled={aGuardar || atual === 'ver'} onClick={() => setPasso('confirmar')} data-testid="mais18-ver">
        Tenho 18+ e quero ver{atual === 'ver' ? ' — atual' : ''}
      </Button>
    </div>
  );
}

/** Cartão inicial: janela que só se fecha com uma escolha (sem X, sem clicar fora, sem Esc). */
export function Mais18Card() {
  const { user, isMockMode } = useAuth();
  // Só quando a conta ainda não escolheu (null). Modo mock: inalterado (o utilizador mock não tem este campo).
  const aberto = !!user && !isMockMode && user.preferenciaMais18 === null;

  return (
    <Dialog open={aberto}>
      <DialogContent
        className="max-w-md [&>button]:hidden"
        data-testid="mais18-card"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Conteúdo +18</DialogTitle>
          <DialogDescription>
            As criadoras marcam o conteúdo +18 (publicações, stories e lives). Escolhe se o queres filtrar ou ver.
            Podes mudar a qualquer momento em Definições.
          </DialogDescription>
        </DialogHeader>
        <Mais18Opcoes atual={null} />
      </DialogContent>
    </Dialog>
  );
}
