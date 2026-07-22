import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle2 } from 'lucide-react';

interface PlanData {
  nome: string;
  preco: string;
  descricao: string;
}

interface PlanDialogProps {
  open: boolean;
  onClose: () => void;
  mode: 'edit' | 'create';
  initial?: PlanData;
}

export function PlanDialog({ open, onClose, mode, initial }: PlanDialogProps) {
  const [form, setForm] = useState<PlanData>(initial ?? { nome: '', preco: '', descricao: '' });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setForm(initial ?? { nome: '', preco: '', descricao: '' });
      setSaved(false);
      setError('');
    }
  }, [open, initial]);

  function handleSave() {
    if (!form.nome.trim() || !form.preco.trim() || !form.descricao.trim()) {
      setError('Preenche todos os campos.');
      return;
    }
    const preco = Number(form.preco.replace(/\D/g, ''));
    if (!preco || preco < 100) {
      setError('O preço mínimo é 100 Kz.');
      return;
    }
    setError('');
    setSaved(true);
    setTimeout(() => { onClose(); setSaved(false); }, 1500);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
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
        ) : (
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1.5 block">Nome do plano</label>
              <Input
                placeholder="Ex: VIP Club, Premium, Fan Club…"
                value={form.nome}
                onChange={(e) => setForm(f => ({ ...f, nome: e.target.value }))}
                className="bg-secondary border-border"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1.5 block">Preço mensal (Kz)</label>
              <Input
                placeholder="Ex: 4990"
                value={form.preco}
                onChange={(e) => setForm(f => ({ ...f, preco: e.target.value.replace(/[^\d]/g, '') }))}
                className="bg-secondary border-border"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1.5 block">Descrição (o que está incluído)</label>
              <Textarea
                placeholder="Ex: Acesso a todo o conteúdo exclusivo, chat direto e lives privadas."
                value={form.descricao}
                onChange={(e) => setForm(f => ({ ...f, descricao: e.target.value }))}
                className="bg-secondary border-border resize-none"
                rows={3}
              />
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}

            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1 rounded-xl" onClick={onClose}>
                Cancelar
              </Button>
              <Button className="flex-1 rounded-xl font-bold bg-primary hover:bg-primary/90 text-white" onClick={handleSave}>
                {mode === 'edit' ? 'Guardar alterações' : 'Criar plano'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
