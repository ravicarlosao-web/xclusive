import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { getFreshAuthToken } from '@workspace/api-client-react';

export type ReportTargetType = 'post' | 'story' | 'comment' | 'user' | 'live';

const LABEL: Record<ReportTargetType, string> = {
  post: 'publicação', story: 'story', comment: 'comentário', user: 'perfil', live: 'live',
};

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
}

/** Diálogo de denúncia (POST /api/reports). Um só denunciante por alvo; o servidor valida tudo. */
export function ReportDialog({ open, onClose, targetType, targetId }: ReportDialogProps) {
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  function handleClose() {
    setReason(''); setDescription(''); setError('');
    onClose();
  }

  async function handleSubmit() {
    setError('');
    if (!reason) { setError('Escolhe um motivo.'); return; }
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
          {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 rounded-xl" onClick={handleClose}>Cancelar</Button>
            <Button className="flex-1 rounded-xl font-bold" onClick={handleSubmit} disabled={sending}>
              {sending ? 'A enviar…' : 'Enviar denúncia'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
