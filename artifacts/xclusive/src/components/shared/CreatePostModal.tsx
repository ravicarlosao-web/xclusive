import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useCreatePost } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { ImagePlus, MapPin, Lock, X, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface CreatePostModalProps {
  open: boolean;
  onClose: () => void;
}

type Step = 'media' | 'details';

export function CreatePostModal({ open, onClose }: CreatePostModalProps) {
  const queryClient = useQueryClient();
  const { mutate: createPost, isPending } = useCreatePost();

  const [step, setStep] = useState<Step>('media');
  const [mediaUrls, setMediaUrls] = useState<string[]>(['']);
  const [legenda, setLegenda] = useState('');
  const [localizacao, setLocalizacao] = useState('');
  const [exclusivo, setExclusivo] = useState(false);
  const [preco, setPreco] = useState('');

  const validUrls = mediaUrls.filter(u => u.trim() !== '');

  function handleClose() {
    if (isPending) return;
    setStep('media');
    setMediaUrls(['']);
    setLegenda('');
    setLocalizacao('');
    setExclusivo(false);
    setPreco('');
    onClose();
  }

  function handleAddUrl() {
    setMediaUrls(prev => [...prev, '']);
  }

  function handleRemoveUrl(idx: number) {
    setMediaUrls(prev => prev.filter((_, i) => i !== idx));
  }

  function handleUrlChange(idx: number, val: string) {
    setMediaUrls(prev => prev.map((u, i) => (i === idx ? val : u)));
  }

  function handleSubmit() {
    const tipo = validUrls.length > 1 ? 'carrossel' : 'imagem';
    const media = validUrls.map(url => ({ url, tipo: 'imagem' as const }));

    createPost(
      {
        data: {
          legenda: legenda.trim() || undefined,
          localizacao: localizacao.trim() || undefined,
          tipo,
          media,
          exclusivo,
          precoDesbloqueio: exclusivo && preco ? (Number.isFinite(parseFloat(preco)) && parseFloat(preco) >= 0 ? parseFloat(preco) : undefined) : undefined,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['/api/feed'] });
          toast.success('Publicação criada com sucesso!');
          handleClose();
        },
        onError: () => {
          toast.error('Erro ao criar publicação. Tenta novamente.');
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-lg bg-card border-border p-0 overflow-hidden gap-0">
        {/* Header */}
        <DialogHeader className="px-6 py-4 border-b border-border">
          <div className="flex items-center justify-between">
            {step === 'details' && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground -ml-2"
                onClick={() => setStep('media')}
                disabled={isPending}
              >
                Voltar
              </Button>
            )}
            <DialogTitle className={cn('text-base font-semibold', step === 'media' && 'mx-auto')}>
              {step === 'media' ? 'Nova publicação' : 'Detalhes'}
            </DialogTitle>
            {step === 'details' && (
              <Button
                size="sm"
                className="bg-primary hover:bg-primary/90 text-white rounded-lg h-8 px-4 text-sm font-semibold"
                onClick={handleSubmit}
                disabled={isPending}
              >
                {isPending ? 'A publicar…' : 'Partilhar'}
              </Button>
            )}
          </div>
        </DialogHeader>

        {/* Step: Media URLs */}
        {step === 'media' && (
          <div className="px-6 py-6 flex flex-col gap-4">
            <div className="flex flex-col items-center gap-3 py-4 text-muted-foreground">
              <ImagePlus className="w-12 h-12 stroke-[1px] text-primary/60" />
              <p className="text-sm font-medium text-foreground">Adiciona o URL das imagens</p>
              <p className="text-xs text-center text-muted-foreground">
                Cola o link direto para uma imagem (jpg, png, webp)
              </p>
            </div>

            <div className="flex flex-col gap-2">
              {mediaUrls.map((url, idx) => (
                <div key={idx} className="flex gap-2">
                  <Input
                    placeholder="https://exemplo.com/imagem.jpg"
                    value={url}
                    onChange={e => handleUrlChange(idx, e.target.value)}
                    className="bg-secondary border-border text-sm flex-1"
                  />
                  {mediaUrls.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemoveUrl(idx)}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>

            {mediaUrls.length < 10 && (
              <Button
                variant="ghost"
                size="sm"
                className="self-start text-primary hover:text-primary/80 gap-1.5 px-0"
                onClick={handleAddUrl}
              >
                <Plus className="w-4 h-4" />
                Adicionar outra imagem
              </Button>
            )}

            {/* Preview thumbnails */}
            {validUrls.length > 0 && (
              <div className="flex gap-2 flex-wrap mt-2">
                {validUrls.map((url, idx) => (
                  <div key={idx} className="w-20 h-20 rounded-lg overflow-hidden bg-secondary border border-border shrink-0">
                    <img
                      src={url}
                      alt={`preview ${idx + 1}`}
                      className="w-full h-full object-cover"
                      onError={e => { (e.target as HTMLImageElement).style.opacity = '0.3'; }}
                    />
                  </div>
                ))}
              </div>
            )}

            <Button
              className="bg-primary hover:bg-primary/90 text-white rounded-xl h-11 font-semibold mt-2"
              onClick={() => setStep('details')}
              disabled={validUrls.length === 0}
            >
              Seguinte
            </Button>
          </div>
        )}

        {/* Step: Details */}
        {step === 'details' && (
          <div className="px-6 py-5 flex flex-col gap-5">
            {/* Thumbnails row */}
            {validUrls.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {validUrls.map((url, idx) => (
                  <div key={idx} className="w-16 h-16 rounded-lg overflow-hidden bg-secondary shrink-0">
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            )}

            {/* Caption */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Legenda</Label>
              <Textarea
                placeholder="Escreve uma legenda…"
                value={legenda}
                onChange={e => setLegenda(e.target.value)}
                className="bg-secondary border-border resize-none text-sm min-h-[90px]"
                maxLength={2200}
              />
              <span className="text-xs text-muted-foreground text-right">{legenda.length}/2200</span>
            </div>

            {/* Location */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" /> Localização
              </Label>
              <Input
                placeholder="Adicionar localização"
                value={localizacao}
                onChange={e => setLocalizacao(e.target.value)}
                className="bg-secondary border-border text-sm"
              />
            </div>

            {/* Exclusive toggle */}
            <div className="flex items-center justify-between py-2 border-t border-border">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-primary" />
                <div>
                  <p className="text-sm font-medium">Conteúdo exclusivo</p>
                  <p className="text-xs text-muted-foreground">Apenas subscritores podem ver</p>
                </div>
              </div>
              <Switch
                checked={exclusivo}
                onCheckedChange={setExclusivo}
              />
            </div>

            {exclusivo && (
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                  Preço de desbloqueio (€) — opcional
                </Label>
                <Input
                  type="number"
                  placeholder="ex: 4.99"
                  min={0}
                  step={0.01}
                  value={preco}
                  onChange={e => setPreco(e.target.value)}
                  className="bg-secondary border-border text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Deixa vazio para mostrar apenas a subscritores ativos
                </p>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
