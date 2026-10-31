import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/**
 * "Mensagem" no perfil de um criador com regra de quem pode escrever e sem relação: em vez de falhar, explica (texto do servidor)
 * e oferece a ação (seguir / ver a subscrição). Foco preso e Esc fecham (Radix).
 */
export function MensagemRestritaDialog({ aberto, texto, username, podeSeguir, temSubscricao, onSeguir, onSubscrever, onFechar }: {
  aberto: boolean; texto: string; username: string; podeSeguir: boolean; temSubscricao: boolean;
  onSeguir: () => void; onSubscrever: () => void; onFechar: () => void;
}) {
  const botao = 'inline-flex min-h-[44px] items-center justify-center rounded-full px-5 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogContent className="max-w-md" data-testid="mensagem-restrita">
        <DialogHeader>
          <DialogTitle>Não podes enviar mensagem a @{username}</DialogTitle>
          <DialogDescription data-testid="mensagem-restrita-texto">{texto}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          {podeSeguir && <button type="button" data-testid="mensagem-restrita-seguir" onClick={onSeguir} className={`${botao} bg-primary text-white hover:bg-primary/90`}>Seguir @{username}</button>}
          {temSubscricao && <button type="button" data-testid="mensagem-restrita-subscrever" onClick={onSubscrever} className={`${botao} bg-primary text-white hover:bg-primary/90`}>Ver subscrição</button>}
          <button type="button" data-testid="mensagem-restrita-fechar" onClick={onFechar} className={`${botao} border border-border bg-background text-foreground hover:bg-secondary`}>Fechar</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
