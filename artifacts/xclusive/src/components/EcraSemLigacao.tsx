/** Ecrã mostrado quando há sessão guardada mas a API não respondeu (429, 5xx, rede): a pessoa NÃO vai para o login e pode tentar de novo. */
export function EcraSemLigacao({ onTentar }: { onTentar: () => void }) {
  return (
    <main data-testid="sem-ligacao" className="min-h-[100dvh] bg-background flex flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-bold">Não foi possível ligar</h1>
      <p className="max-w-sm text-muted-foreground">Não conseguimos contactar o servidor. A tua sessão continua guardada.</p>
      <button type="button" onClick={onTentar}
        className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-primary px-6 text-sm font-bold text-white transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Tentar novamente
      </button>
    </main>
  );
}
