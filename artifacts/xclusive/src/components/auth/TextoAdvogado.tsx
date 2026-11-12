import { TEXTOS_ADVOGADO_GOOGLE, MARCADORES_GOOGLE, type ChaveTextoGoogle } from '@/lib/textosLegaisGoogle';

/** Mostra o texto do advogado, ou o marcador visível enquanto o texto não existir (ver lib/textosLegaisGoogle.ts). */
export function TextoAdvogado({ id, className = 'text-xs text-muted-foreground' }: { id: ChaveTextoGoogle; className?: string }) {
  const texto = TEXTOS_ADVOGADO_GOOGLE[id];
  return (
    <p className={className} data-testid={`texto-advogado-${id}`} data-marcador={texto === null ? 'sim' : undefined}>
      {texto ?? MARCADORES_GOOGLE[id]}
    </p>
  );
}
