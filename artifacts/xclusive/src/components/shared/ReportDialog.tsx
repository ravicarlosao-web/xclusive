import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { getFreshAuthToken, useReportMessage } from '@workspace/api-client-react';
import { CheckCircle2 } from 'lucide-react';

export type ReportTargetType = 'post' | 'story' | 'comment' | 'user' | 'live' | 'mensagem';

const LABEL: Record<ReportTargetType, string> = {
  post: 'publicação', story: 'story', comment: 'comentário', user: 'perfil', live: 'live', mensagem: 'mensagem',
};

const AVISO_MENSAGEM = 'A equipa poderá ver esta mensagem e o contexto à volta dela (até 20 mensagens antes e depois, de ambos os lados).';

/** Erro da denúncia de mensagem → texto pt-PT pelo estado HTTP (o servidor valida tudo). `repetir`: mostra «Tentar novamente». */
function erroMensagem(e: unknown): { texto: string; repetir: boolean } {
  const st = (e as { status?: number } | null)?.status;
  const data = (e as { data?: { error?: unknown; details?: { mensagem?: string }[] } } | null)?.data;
  if (st === 409) return { texto: 'Já denunciaste esta mensagem.', repetir: false };
  if (st === 429) return { texto: 'Demasiadas denúncias; tenta mais tarde.', repetir: false };
  if (st === 404 || st === 403) return { texto: 'Conversa indisponível.', repetir: false };
  if (st === 400) return { texto: data?.details?.[0]?.mensagem || (typeof data?.error === 'string' && data.error) || 'Não foi possível enviar a denúncia. Verifica os dados.', repetir: false };
  return { texto: 'Não foi possível enviar a denúncia.', repetir: true };
}

const MOTIVOS: { value: string; label: string }[] = [
  { value: 'menor', label: 'Menor de idade em conteúdo adulto' },
  { value: 'sem_consentimento', label: 'Conteúdo partilhado sem consentimento' },
  { value: 'direitos_autor', label: 'Violação de direitos de autor' },
  { value: 'violencia', label: 'Violência ou ameaças' },
  { value: 'assedio', label: 'Assédio ou abuso' },
  { value: 'spam', label: 'Spam ou burla' },
  { value: 'conteudo_mais18_nao_marcado', label: 'Conteúdo +18 que não está marcado' },
  { value: 'outro', label: 'Outro motivo' },
];

interface ReportDialogProps {
  open: boolean;
  onClose: () => void;
  targetType: ReportTargetType;
  targetId: number;
  /** Só para targetType 'mensagem': a conversa onde está a mensagem (POST /conversations/:id/denunciar). */
  conversaId?: number;
  /** Só para 'mensagem': chamado depois de a denúncia ser aceite (ex.: recarregar a conversa se a mensagem foi retirada). */
  onEnviada?: () => void;
}

/** Diálogo de denúncia (POST /api/reports). Um só denunciante por alvo; o servidor valida tudo. */
export function ReportDialog({ open, onClose, targetType, targetId, conversaId, onEnviada }: ReportDialogProps) {
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [repetir, setRepetir] = useState(false);
  const [enviada, setEnviada] = useState(false);
  const denunciarMensagem = useReportMessage();

  function handleClose() {
    setReason(''); setDescription(''); setError(''); setRepetir(false); setEnviada(false);
    onClose();
  }

  /** Denúncia de mensagem: POST /conversations/:id/denunciar. Não altera o fluxo dos outros tipos. */
  async function enviarMensagem() {
    if (!conversaId) { setError('Conversa indisponível.'); return; }
    if (reason === 'outro' && description.trim().length < 5) { setError('Descreve brevemente o motivo (mínimo 5 caracteres).'); return; }
    setSending(true); setRepetir(false);
    try {
      await denunciarMensagem.mutateAsync({ id: conversaId, data: { mensagemId: targetId, motivo: reason as never, ...(description.trim() ? { descricao: description.trim() } : {}) } });
      setEnviada(true);
      onEnviada?.();
    } catch (e) {
      const r = erroMensagem(e);
      setError(r.texto); setRepetir(r.repetir);
    } finally {
      setSending(false);
    }
  }

  async function handleSubmit() {
    setError('');
    if (!reason) { setError('Escolhe um motivo.'); return; }
    if (targetType === 'mensagem') { await enviarMensagem(); return; }
    setSending(true);
    try {
      const token = await getFreshAuthToken();
      const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
      const res = await fetch(`${base}/api/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        credentials: 'same-origin',
        body: JSON.stringify({ targetType, targetId, reason, description: description.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = Array.isArray(body?.details) && body.details[0]?.mensagem;
        setError(detail || body?.error || 'Não foi possível enviar a denúncia.');
        return;
      }
      toast({
        title: 'Denúncia enviada',
        description: body.retiradoTemporariamente
          ? 'O conteúdo foi retirado temporariamente enquanto a equipa analisa.'
          : 'Obrigado. A nossa equipa vai analisar.',
      });
      handleClose();
    } catch {
      setError('Não foi possível enviar a denúncia. Tenta novamente.');
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-[420px] bg-card border-border rounded-2xl">
        <DialogHeader>
          <DialogTitle>Denunciar {LABEL[targetType]}</DialogTitle>
          <DialogDescription>Diz-nos o que se passa. A denúncia é analisada pela equipa e o autor não sabe quem denunciou.</DialogDescription>
        </DialogHeader>

        {targetType === 'mensagem' && enviada ? (
          <div className="space-y-4">
            <div data-testid="denuncia-confirmacao" role="status" aria-live="polite" className="flex items-center gap-3 rounded-xl border border-border bg-secondary p-4">
              <CheckCircle2 className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
              <p className="text-sm font-semibold">Denúncia enviada. Obrigado.</p>
            </div>
            <Button className="min-h-[44px] w-full rounded-xl font-bold" data-testid="denuncia-fechar" onClick={handleClose}>Fechar</Button>
          </div>
        ) : (
        <div className="space-y-3">
          <div className="space-y-1.5" role="radiogroup" aria-label="Motivo da denúncia">
            {MOTIVOS.filter((m) => m.value !== 'conteudo_mais18_nao_marcado' || ['post', 'story', 'live'].includes(targetType)).map((m) => (
              <label key={m.value} className="flex items-center gap-2 text-sm cursor-pointer rounded-lg px-2 py-1.5 hover:bg-secondary/60">
                <input type="radio" name="motivo" value={m.value} checked={reason === m.value} onChange={() => setReason(m.value)} />
                {m.label}
              </label>
            ))}
          </div>
          <textarea
            className="w-full min-h-[80px] rounded-md bg-secondary border border-border px-3 py-2 text-sm"
            placeholder="Detalhes (opcional; obrigatório em «Outro motivo»)"
            maxLength={1000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          {targetType === 'mensagem' && <p data-testid="denuncia-aviso" className="rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">{AVISO_MENSAGEM}</p>}
          {error && <p className="text-xs text-destructive" role="alert" data-testid="denuncia-erro">{error}</p>}
          <div className={targetType === 'mensagem' ? 'flex gap-2 [&>button]:min-h-[44px]' : 'flex gap-2'}>
            <Button variant="outline" className="flex-1 rounded-xl" onClick={handleClose}>Cancelar</Button>
            <Button className="flex-1 rounded-xl font-bold" onClick={handleSubmit} disabled={sending} data-testid="denuncia-enviar">
              {sending ? 'A enviar…' : repetir ? 'Tentar novamente' : 'Enviar denúncia'}
            </Button>
          </div>
        </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
