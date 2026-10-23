import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTema } from '@/hooks/useTema';

/**
 * Botão para alternar entre modo noturno (padrão) e modo diurno.
 * Mostra o ícone do modo para onde vai mudar: Sol no noturno, Lua no diurno. Alvo de toque de 44px.
 * Ainda NÃO é renderizado em nenhum ecrã (entra numa fase seguinte).
 */
export function BotaoTema({ className }: { className?: string }) {
  const { noturno, alternar } = useTema();
  const rotulo = noturno ? 'Mudar para o modo diurno' : 'Mudar para o modo noturno';

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={alternar}
      aria-label={rotulo}
      aria-pressed={!noturno}
      title={rotulo}
      data-testid="botao-tema"
      className={cn('h-11 w-11 min-h-[44px] min-w-[44px] rounded-full', className)}
    >
      {noturno ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </Button>
  );
}
