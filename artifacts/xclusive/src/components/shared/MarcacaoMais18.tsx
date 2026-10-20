import { cn } from '@/lib/utils';

/** Selo "+18" nos cartões de post, reel, story e live. Só aparece quando o conteúdo está marcado. */
export function SeloMais18({ mais18, className }: { mais18?: boolean | null; className?: string }) {
  if (!mais18) return null;
  return (
    <span
      data-testid="selo-mais18"
      title="Conteúdo +18"
      className={cn(
        'inline-flex items-center rounded-md bg-red-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white shadow',
        className,
      )}
    >
      +18
    </span>
  );
}

/**
 * Seletor obrigatório "Este conteúdo é +18? Sim / Não". Sem valor pré-selecionado (valor === null):
 * quem o usa tem de bloquear o botão de publicar enquanto não for escolhido.
 */
export function SeletorMais18({
  valor,
  onChange,
  disabled,
  dark,
  className,
}: {
  valor: boolean | null;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  dark?: boolean;
  className?: string;
}) {
  const btn = (ativo: boolean) =>
    cn(
      'flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-60',
      ativo
        ? 'border-primary bg-primary/20 text-primary'
        : dark
          ? 'border-white/20 bg-white/5 text-white/80'
          : 'border-border bg-secondary/30 text-muted-foreground',
    );
  return (
    <div data-testid="seletor-mais18" className={cn('flex flex-col gap-1.5', className)}>
      <p className={cn('text-sm font-semibold', dark ? 'text-white' : 'text-foreground')}>
        Este conteúdo é +18? <span className="text-red-500">*</span>
      </p>
      <div role="radiogroup" aria-label="Este conteúdo é +18?" className="flex gap-2">
        <button type="button" role="radio" aria-checked={valor === true} disabled={disabled} onClick={() => onChange(true)} className={btn(valor === true)} data-testid="mais18-sim">
          Sim
        </button>
        <button type="button" role="radio" aria-checked={valor === false} disabled={disabled} onClick={() => onChange(false)} className={btn(valor === false)} data-testid="mais18-nao">
          Não
        </button>
      </div>
      {valor === null && (
        <p className={cn('text-[11px]', dark ? 'text-white/60' : 'text-muted-foreground')}>
          Escolhe uma opção para poderes publicar. Conteúdo +18 só é visto por quem o ativou nas definições.
        </p>
      )}
    </div>
  );
}
