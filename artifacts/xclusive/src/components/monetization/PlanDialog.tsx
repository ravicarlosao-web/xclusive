import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle2, Loader2, Trash2 } from 'lucide-react';
import {
  useCreateSubscriptionPlan,
  useUpdateSubscriptionPlan,
  useDeleteSubscriptionPlan,
  type SubscriptionPlan,
} from '@workspace/api-client-react';

interface PlanDialogProps {
  open: boolean;
  onClose: () => void;
  mode: 'edit' | 'create';
  plan?: SubscriptionPlan | null;
  onSaved?: () => void;
}

export function PlanDialog({ open, onClose, mode, plan, onSaved }: PlanDialogProps) {
  const [nome, setNome] = useState('');
  const [preco, setPreco] = useState('');
  const [descricao, setDescricao] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { mutate: createPlan, isPending: creating } = useCreateSubscriptionPlan();
  const { mutate: updatePlan, isPending: updating } = useUpdateSubscriptionPlan();
  const { mutate: deletePlan, isPending: deleting } = useDeleteSubscriptionPlan();

  const isPending = creating || updating || deleting;

  useEffect(() => {
    if (open) {
      setNome(plan?.nome ?? '');
      setPreco(plan?.preco != null ? String(Math.round(plan.preco)) : '');
      setDescricao(plan?.beneficios ?? '');
      setSaved(false);
      setError('');
      setConfirmDelete(false);
    }
  }, [open, plan]);

  function validate() {
    if (!nome.trim()) { setError('O nome do plano é obrigatório.'); return false; }
    const p = Number(preco);
    if (!preco || isNaN(p) || p < 100) { setError('O preço mínimo é 100 Kz.'); return false; }
    if (!descricao.trim()) { setError('A descrição é obrigatória.'); return false; }
    return true;
  }

  function handleSave() {
    setError('');
    if (!validate()) return;
    const precoNum = Number(preco);

    if (mode === 'create') {
      createPlan(
        { data: { nome: nome.trim(), preco: precoNum, beneficios: descricao.trim(), ativo: true } },
        {
          onSuccess: () => { setSaved(true); onSaved?.(); setTimeout(onClose, 1500); },
          onError: () => setError('Erro ao criar plano. Tenta novamente.'),
        },
      );
    } else if (plan) {
      updatePlan(
        { id: plan.id, data: { nome: nome.trim(), preco: precoNum, beneficios: descricao.trim() } },
        {
          onSuccess: () => { setSaved(true); onSaved?.(); setTimeout(onClose, 1500); },
          onError: () => setError('Erro ao atualizar plano. Tenta novamente.'),
        },
      );
    }
  }

  function handleDelete() {
    if (!plan) return;
    deletePlan(
      { id: plan.id },
      {
        onSuccess: () => { onSaved?.(); onClose(); },
        onError: () => setError('Erro ao eliminar plano. Tenta novamente.'),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !isPending) onClose(); }}>
      <DialogContent className="sm:max-w-[420px] bg-card border-border rounded-2xl">
        <DialogHeader>
          <DialogTitle>
            {mode === 'edit' ? 'Editar plano de subscrição' : 'Criar novo nível de subscrição'}
          </DialogTitle>
        </DialogHeader>

        {saved ? (
          <div className="flex flex-col items-center text-center py-6">
            <div className="w-14 h-14 rounded-full bg-green-500/15 flex items-center justify-center mb-3">
              <CheckCircle2 className="w-7 h-7 text-green-400" />
            </div>
            <p className="font-semibold">
              {mode === 'edit' ? 'Plano atualizado!' : 'Novo nível criado!'}
            </p>
          </div>
        ) : confirmDelete ? (
          <div className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              Tens a certeza que queres eliminar o plano <strong className="text-foreground">"{plan?.nome}"</strong>?
              Esta ação não pode ser revertida.
            </p>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                Cancelar
              </Button>
              <Button
                variant="destructive"
                className="flex-1 rounded-xl font-bold"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Eliminar'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1.5 block">Nome do plano</label>
              <Input
                placeholder="Ex: VIP Club, Premium, Fan Club…"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className="bg-secondary border-border"
                disabled={isPending}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1.5 block">Preço mensal (Kz)</label>
              <Input
                placeholder="Ex: 4990"
                value={preco}
                onChange={(e) => setPreco(e.target.value.replace(/[^\d]/g, ''))}
                className="bg-secondary border-border"
                disabled={isPending}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1.5 block">Descrição (o que está incluído)</label>
              <Textarea
                placeholder="Ex: Acesso a todo o conteúdo exclusivo, chat direto e lives privadas."
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                className="bg-secondary border-border resize-none"
                rows={3}
                disabled={isPending}
              />
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}

            <div className="flex gap-2 pt-1">
              {mode === 'edit' && plan && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 text-destructive hover:bg-destructive/10 rounded-xl shrink-0"
                  onClick={() => setConfirmDelete(true)}
                  disabled={isPending}
                  title="Eliminar plano"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
              <Button variant="outline" className="flex-1 rounded-xl" onClick={onClose} disabled={isPending}>
                Cancelar
              </Button>
              <Button
                className="flex-1 rounded-xl font-bold bg-primary hover:bg-primary/90 text-white"
                onClick={handleSave}
                disabled={isPending}
              >
                {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : mode === 'edit' ? 'Guardar' : 'Criar plano'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
