import { useState, useRef, useCallback, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useCreatePost } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ImagePlus, MapPin, Lock, X, ChevronLeft, ChevronRight,
  Film, Upload, Hash, AtSign, Smile, Layers, Type
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

interface CreatePostModalProps {
  open: boolean;
  onClose: () => void;
}

type Step = 'select' | 'preview' | 'details' | 'texto';

interface MediaFile {
  file: File;
  previewUrl: string;
  tipo: 'imagem' | 'video';
  duration?: number;
}

const MAX_FILES = 10;
const MAX_SIZE_MB = 100;
const MAX_TEXTO = 2200;

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CreatePostModal({ open, onClose }: CreatePostModalProps) {
  const queryClient = useQueryClient();
  const { mutate: createPost, isPending } = useCreatePost();

  const [step, setStep] = useState<Step>('select');
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [legenda, setLegenda] = useState('');
  const [localizacao, setLocalizacao] = useState('');
  const [exclusivo, setExclusivo] = useState(false);
  const [preco, setPreco] = useState('');
  const [audiencia, setAudiencia] = useState<'todos' | 'seguidores' | 'subscritores'>('todos');

  // Text post state
  const [textoConteudo, setTextoConteudo] = useState('');
  const [textoLocalizacao, setTextoLocalizacao] = useState('');
  const [textoExclusivo, setTextoExclusivo] = useState(false);
  const [textoPreco, setTextoPreco] = useState('');
  const [textoAudiencia, setTextoAudiencia] = useState<'todos' | 'seguidores' | 'subscritores'>('todos');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const textoRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    return () => {
      mediaFiles.forEach(m => URL.revokeObjectURL(m.previewUrl));
    };
  }, []);

  // Auto-focus text area when switching to text step
  useEffect(() => {
    if (step === 'texto') {
      setTimeout(() => textoRef.current?.focus(), 100);
    }
  }, [step]);

  function handleClose() {
    if (isPending) return;
    mediaFiles.forEach(m => URL.revokeObjectURL(m.previewUrl));
    setStep('select');
    setMediaFiles([]);
    setCurrentIndex(0);
    setLegenda('');
    setLocalizacao('');
    setExclusivo(false);
    setPreco('');
    setAudiencia('todos');
    setTextoConteudo('');
    setTextoLocalizacao('');
    setTextoExclusivo(false);
    setTextoPreco('');
    setTextoAudiencia('todos');
    onClose();
  }

  function processFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    const allowed = arr.filter(f => {
      if (!f.type.startsWith('image/') && !f.type.startsWith('video/')) {
        toast.error(`"${f.name}" não é suportado. Usa imagens ou vídeos.`);
        return false;
      }
      if (f.size > MAX_SIZE_MB * 1024 * 1024) {
        toast.error(`"${f.name}" é demasiado grande. Máximo ${MAX_SIZE_MB}MB.`);
        return false;
      }
      return true;
    });

    const total = mediaFiles.length + allowed.length;
    const toAdd = total > MAX_FILES ? allowed.slice(0, MAX_FILES - mediaFiles.length) : allowed;
    if (total > MAX_FILES) toast.warning(`Máximo de ${MAX_FILES} ficheiros. Alguns foram ignorados.`);

    const newMedia: MediaFile[] = toAdd.map(file => ({
      file,
      previewUrl: URL.createObjectURL(file),
      tipo: file.type.startsWith('video/') ? 'video' : 'imagem',
    }));

    setMediaFiles(prev => [...prev, ...newMedia]);

    if (toAdd.length > 0) {
      setStep('preview');
      setCurrentIndex(mediaFiles.length);
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
    }
    e.target.value = '';
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) processFiles(e.dataTransfer.files);
  }, [mediaFiles]);

  function removeFile(idx: number) {
    URL.revokeObjectURL(mediaFiles[idx].previewUrl);
    setMediaFiles(prev => prev.filter((_, i) => i !== idx));
    setCurrentIndex(prev => Math.max(0, prev >= idx ? prev - 1 : prev));
    if (mediaFiles.length === 1) setStep('select');
  }

  // ── Submit: media post ──
  async function handleSubmit() {
    if (mediaFiles.length === 0) return;

    const tipo = mediaFiles.length > 1
      ? 'carrossel'
      : mediaFiles[0].tipo === 'video' ? 'video' : 'imagem';

    const precoNumerico = exclusivo && preco
      ? (() => { const v = parseFloat(preco); return Number.isFinite(v) && v >= 0 ? v : undefined; })()
      : undefined;

    let uploadedMedia: { url: string; tipo: 'imagem' | 'video' }[] = [];
    try {
      const formData = new FormData();
      mediaFiles.forEach(m => formData.append('files', m.file));
      const token = localStorage.getItem('xclusive_token');
      const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
      const uploadRes = await fetch(`${base}/api/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!uploadRes.ok) throw new Error(`Upload falhou: ${uploadRes.status}`);
      const uploadJson = await uploadRes.json() as { files: { url: string; tipo: string }[] };
      uploadedMedia = uploadJson.files.map(f => ({
        url: new URL(f.url, window.location.origin).href,
        tipo: f.tipo === 'video' ? 'video' : 'imagem',
      }));
    } catch (err) {
      console.error('[CreatePostModal] upload error:', err);
      toast.error('Erro ao enviar ficheiros. Tenta novamente.');
      return;
    }

    createPost(
      { data: { legenda: legenda.trim() || undefined, localizacao: localizacao.trim() || undefined, tipo, media: uploadedMedia, exclusivo, precoDesbloqueio: precoNumerico } },
      {
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/feed'] }); toast.success('Publicação criada!'); handleClose(); },
        onError: () => { toast.error('Erro ao criar publicação.'); handleClose(); },
      }
    );
  }

  // ── Submit: text post ──
  async function handleSubmitTexto() {
    if (!textoConteudo.trim()) { toast.error('Escreve algo para publicar.'); return; }

    const precoNumerico = textoExclusivo && textoPreco
      ? (() => { const v = parseFloat(textoPreco); return Number.isFinite(v) && v >= 0 ? v : undefined; })()
      : undefined;

    createPost(
      {
        data: {
          legenda: textoConteudo.trim(),
          localizacao: textoLocalizacao.trim() || undefined,
          tipo: 'texto' as any,
          exclusivo: textoExclusivo,
          precoDesbloqueio: precoNumerico,
        },
      },
      {
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/feed'] }); toast.success('Publicação criada!'); handleClose(); },
        onError: () => { toast.error('Erro ao criar publicação.'); handleClose(); },
      }
    );
  }

  const current = mediaFiles[currentIndex];
  const charCount = legenda.length;
  const textoRemaining = MAX_TEXTO - textoConteudo.length;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent
        className="p-0 overflow-hidden gap-0 border-border bg-card"
        style={{ maxWidth: step === 'details' ? '860px' : '540px', width: '95vw' }}
      >
        {/* ── Header ── */}
        <DialogHeader className="px-4 py-3 border-b border-border">
          <div className="flex items-center justify-between">
            {(step === 'preview' || step === 'details' || step === 'texto') && (
              <Button
                variant="ghost" size="sm"
                className="text-muted-foreground hover:text-foreground -ml-2 gap-1"
                onClick={() => {
                  if (step === 'preview') setStep('select');
                  else if (step === 'details') setStep('preview');
                  else if (step === 'texto') setStep('select');
                }}
                disabled={isPending}
              >
                <ChevronLeft className="w-4 h-4" /> Voltar
              </Button>
            )}
            <DialogTitle className={cn('text-[15px] font-semibold', (step === 'select') && 'mx-auto')}>
              {step === 'select' && 'Nova publicação'}
              {step === 'preview' && 'Pré-visualização'}
              {step === 'details' && 'Detalhes'}
              {step === 'texto' && 'Nova publicação'}
            </DialogTitle>
            {step === 'preview' && (
              <Button size="sm" className="bg-transparent text-primary hover:bg-primary/10 font-semibold rounded-lg h-8 px-4 text-sm" onClick={() => setStep('details')}>
                Seguinte
              </Button>
            )}
            {step === 'details' && (
              <Button size="sm" className="bg-primary hover:bg-primary/90 text-white rounded-lg h-8 px-4 text-sm font-semibold" onClick={handleSubmit} disabled={isPending || mediaFiles.length === 0}>
                {isPending ? 'A publicar…' : 'Partilhar'}
              </Button>
            )}
            {step === 'texto' && (
              <Button size="sm" className="bg-primary hover:bg-primary/90 text-white rounded-lg h-8 px-4 text-sm font-semibold" onClick={handleSubmitTexto} disabled={isPending || !textoConteudo.trim()}>
                {isPending ? 'A publicar…' : 'Publicar'}
              </Button>
            )}
          </div>
        </DialogHeader>

        {/* ══════════════ STEP: SELECT ══════════════ */}
        {step === 'select' && (
          <div className="p-6 flex flex-col gap-4">
            {/* Drop Zone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'relative flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed cursor-pointer transition-all py-12 px-6 text-center',
                isDragging ? 'border-primary bg-primary/10 scale-[0.99]' : 'border-border hover:border-primary/50 hover:bg-secondary/50'
              )}
            >
              <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={handleFileInput} />
              <div className="flex items-center gap-3">
                <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <ImagePlus className="w-8 h-8 text-primary" strokeWidth={1.5} />
                </div>
                <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <Film className="w-8 h-8 text-primary" strokeWidth={1.5} />
                </div>
              </div>
              <div>
                <p className="text-lg font-semibold text-foreground mb-1">Arrasta as tuas fotos e vídeos</p>
                <p className="text-sm text-muted-foreground">ou clica para selecionar do dispositivo</p>
              </div>
              <Button type="button" className="bg-primary hover:bg-primary/90 text-white rounded-xl h-10 px-6 font-semibold gap-2 pointer-events-none">
                <Upload className="w-4 h-4" /> Selecionar ficheiros
              </Button>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>JPG · PNG · WEBP · MP4 · MOV</span>
                <span>·</span>
                <span>Máx. {MAX_SIZE_MB}MB</span>
                <span>·</span>
                <span>Até {MAX_FILES} ficheiros</span>
              </div>
              {isDragging && (
                <div className="absolute inset-0 rounded-2xl bg-primary/5 flex items-center justify-center pointer-events-none">
                  <p className="text-primary font-bold text-lg">Larga aqui!</p>
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground font-medium">ou</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            {/* Text Post Option */}
            <button
              onClick={() => setStep('texto')}
              className="flex items-center gap-4 p-4 rounded-2xl border border-border hover:border-primary/50 hover:bg-secondary/50 transition-all text-left group"
            >
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                <Type className="w-6 h-6 text-primary" strokeWidth={1.5} />
              </div>
              <div>
                <p className="font-semibold text-sm text-foreground">Publicação de texto</p>
                <p className="text-xs text-muted-foreground mt-0.5">Partilha um pensamento, opinião ou actualização — sem imagens</p>
              </div>
            </button>

            {/* If already has some files */}
            {mediaFiles.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Ficheiros selecionados ({mediaFiles.length}/{MAX_FILES})
                </p>
                <div className="flex gap-2 flex-wrap">
                  {mediaFiles.map((m, idx) => (
                    <div key={idx} className="relative w-20 h-20 rounded-xl overflow-hidden bg-secondary border border-border shrink-0 group">
                      {m.tipo === 'video'
                        ? <video src={m.previewUrl} className="w-full h-full object-cover" />
                        : <img src={m.previewUrl} alt="" className="w-full h-full object-cover" />
                      }
                      {m.tipo === 'video' && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                          <Film className="w-5 h-5 text-white drop-shadow" />
                        </div>
                      )}
                      <button onClick={e => { e.stopPropagation(); removeFile(idx); }} className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <X className="w-3 h-3 text-white" />
                      </button>
                    </div>
                  ))}
                </div>
                <Button className="bg-primary hover:bg-primary/90 text-white rounded-xl h-10 font-semibold" onClick={() => setStep('preview')}>
                  Ver pré-visualização
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ══════════════ STEP: TEXTO ══════════════ */}
        {step === 'texto' && (
          <div className="flex flex-col">
            {/* Main compose area */}
            <div className="p-4 sm:p-5 flex flex-col gap-4 min-h-[320px]">
              <Textarea
                ref={textoRef}
                placeholder="O que está a acontecer?"
                value={textoConteudo}
                onChange={e => setTextoConteudo(e.target.value.slice(0, MAX_TEXTO))}
                className="bg-transparent border-none shadow-none resize-none text-lg font-medium placeholder:text-muted-foreground/60 focus-visible:ring-0 p-0 min-h-[180px]"
                maxLength={MAX_TEXTO}
              />

              {/* Toolbar */}
              <div className="flex items-center gap-3 text-muted-foreground border-t border-border pt-3">
                <button className="hover:text-foreground transition-colors" title="Emoji">
                  <Smile className="w-5 h-5" />
                </button>
                <button className="hover:text-foreground transition-colors" title="Mencionar">
                  <AtSign className="w-5 h-5" />
                </button>
                <button className="hover:text-foreground transition-colors" title="Hashtag">
                  <Hash className="w-5 h-5" />
                </button>
                <div className="flex-1" />
                {/* Character counter */}
                <div className="relative w-8 h-8">
                  <svg className="w-8 h-8 -rotate-90" viewBox="0 0 32 32">
                    <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-border" />
                    <circle
                      cx="16" cy="16" r="13" fill="none"
                      stroke="currentColor" strokeWidth="2.5"
                      strokeDasharray={`${2 * Math.PI * 13}`}
                      strokeDashoffset={`${2 * Math.PI * 13 * (1 - textoConteudo.length / MAX_TEXTO)}`}
                      className={textoRemaining <= 20 ? 'text-destructive' : textoRemaining <= 100 ? 'text-yellow-500' : 'text-primary'}
                      strokeLinecap="round"
                    />
                  </svg>
                  {textoRemaining <= 100 && (
                    <span className={cn('absolute inset-0 flex items-center justify-center text-[9px] font-bold', textoRemaining <= 20 ? 'text-destructive' : 'text-muted-foreground')}>
                      {textoRemaining}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Options */}
            <div className="border-t border-border p-4 sm:p-5 flex flex-col gap-4 bg-secondary/20">
              {/* Location */}
              <div className="flex items-center gap-3">
                <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
                <Input
                  placeholder="Localização (opcional)"
                  value={textoLocalizacao}
                  onChange={e => setTextoLocalizacao(e.target.value)}
                  className="bg-transparent border-none shadow-none p-0 text-sm focus-visible:ring-0 placeholder:text-muted-foreground/60 h-auto"
                />
              </div>

              {/* Audience */}
              <div className="flex flex-col gap-2">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">Audiência</Label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { value: 'todos', label: 'Todos' },
                    { value: 'seguidores', label: 'Seguidores' },
                    { value: 'subscritores', label: 'Subscritores' },
                  ] as const).map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => { setTextoAudiencia(opt.value); setTextoExclusivo(opt.value === 'subscritores'); }}
                      className={cn(
                        'py-2 px-3 rounded-xl text-xs font-semibold border transition-all',
                        textoAudiencia === opt.value ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:border-primary/40'
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Exclusive */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                    <Lock className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Conteúdo exclusivo</p>
                    <p className="text-xs text-muted-foreground">Apenas subscritores ativos</p>
                  </div>
                </div>
                <Switch
                  checked={textoExclusivo}
                  onCheckedChange={v => { setTextoExclusivo(v); setTextoAudiencia(v ? 'subscritores' : 'todos'); }}
                />
              </div>

              {textoExclusivo && (
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Preço de desbloqueio (Kz) — opcional</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">Kz</span>
                    <Input
                      type="number" placeholder="ex: 990" min={0} step={100}
                      value={textoPreco} onChange={e => setTextoPreco(e.target.value)}
                      className="bg-secondary/50 border-border text-sm rounded-xl pl-10"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══════════════ STEP: PREVIEW ══════════════ */}
        {step === 'preview' && (
          <div className="flex flex-col">
            <div className="relative w-full bg-black aspect-square flex items-center justify-center overflow-hidden">
              <AnimatePresence mode="wait">
                {current && (
                  <motion.div key={currentIndex} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="w-full h-full flex items-center justify-center">
                    {current.tipo === 'video'
                      ? <video ref={videoRef} src={current.previewUrl} className="max-w-full max-h-full object-contain" controls autoPlay loop muted />
                      : <img src={current.previewUrl} alt="Preview" className="max-w-full max-h-full object-contain" />
                    }
                  </motion.div>
                )}
              </AnimatePresence>

              {mediaFiles.length > 1 && (
                <>
                  <button onClick={() => setCurrentIndex(i => Math.max(0, i - 1))} disabled={currentIndex === 0} className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/60 flex items-center justify-center disabled:opacity-0 hover:bg-black/80 transition-all z-10">
                    <ChevronLeft className="w-5 h-5 text-white" />
                  </button>
                  <button onClick={() => setCurrentIndex(i => Math.min(mediaFiles.length - 1, i + 1))} disabled={currentIndex === mediaFiles.length - 1} className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/60 flex items-center justify-center disabled:opacity-0 hover:bg-black/80 transition-all z-10">
                    <ChevronRight className="w-5 h-5 text-white" />
                  </button>
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
                    {mediaFiles.map((_, i) => (
                      <button key={i} onClick={() => setCurrentIndex(i)} className={cn('w-1.5 h-1.5 rounded-full transition-all', i === currentIndex ? 'bg-primary w-4' : 'bg-white/60')} />
                    ))}
                  </div>
                  <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm rounded-full px-2.5 py-1 flex items-center gap-1.5 z-10">
                    <Layers className="w-3.5 h-3.5 text-white" />
                    <span className="text-xs text-white font-semibold">{currentIndex + 1}/{mediaFiles.length}</span>
                  </div>
                </>
              )}
              {current?.tipo === 'video' && (
                <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-sm rounded-full px-2.5 py-1 flex items-center gap-1.5 z-10">
                  <Film className="w-3.5 h-3.5 text-white" />
                  <span className="text-xs text-white font-semibold">Vídeo</span>
                </div>
              )}
            </div>

            {mediaFiles.length > 1 && (
              <div className="flex gap-1.5 p-3 overflow-x-auto border-t border-border bg-card">
                {mediaFiles.map((m, idx) => (
                  <div key={idx} className="relative group shrink-0">
                    <button onClick={() => setCurrentIndex(idx)} className={cn('w-14 h-14 rounded-lg overflow-hidden border-2 transition-all', idx === currentIndex ? 'border-primary scale-105' : 'border-transparent opacity-70 hover:opacity-100')}>
                      {m.tipo === 'video' ? <video src={m.previewUrl} className="w-full h-full object-cover" /> : <img src={m.previewUrl} alt="" className="w-full h-full object-cover" />}
                      {m.tipo === 'video' && <div className="absolute inset-0 flex items-center justify-center bg-black/30"><Film className="w-3.5 h-3.5 text-white" /></div>}
                    </button>
                    <button onClick={() => removeFile(idx)} className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-destructive flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 shadow">
                      <X className="w-2.5 h-2.5 text-white" />
                    </button>
                  </div>
                ))}
                {mediaFiles.length < MAX_FILES && (
                  <button onClick={() => fileInputRef.current?.click()} className="w-14 h-14 rounded-lg border-2 border-dashed border-border flex items-center justify-center shrink-0 hover:border-primary/50 hover:bg-secondary/50 transition-colors">
                    <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={handleFileInput} />
                    <ImagePlus className="w-5 h-5 text-muted-foreground" />
                  </button>
                )}
              </div>
            )}

            <div className="px-4 py-2 border-t border-border bg-secondary/30">
              <p className="text-xs text-muted-foreground">
                {formatFileSize(mediaFiles.reduce((s, m) => s + m.file.size, 0))} total
                {mediaFiles.length === 1 && ` · ${current?.file.name}`}
              </p>
            </div>
          </div>
        )}

        {/* ══════════════ STEP: DETAILS ══════════════ */}
        {step === 'details' && (
          <div className="flex flex-col sm:flex-row max-h-[80vh]">
            <div className="sm:w-[380px] bg-black flex-shrink-0 flex items-center justify-center aspect-square sm:aspect-auto relative">
              {current && (
                <>
                  {current.tipo === 'video'
                    ? <video src={current.previewUrl} className="max-w-full max-h-full object-contain w-full" controls loop muted />
                    : <img src={current.previewUrl} alt="Preview" className="max-w-full max-h-full object-contain w-full" />
                  }
                  {mediaFiles.length > 1 && (
                    <>
                      <button onClick={() => setCurrentIndex(i => Math.max(0, i - 1))} disabled={currentIndex === 0} className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/60 flex items-center justify-center disabled:opacity-0">
                        <ChevronLeft className="w-5 h-5 text-white" />
                      </button>
                      <button onClick={() => setCurrentIndex(i => Math.min(mediaFiles.length - 1, i + 1))} disabled={currentIndex === mediaFiles.length - 1} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/60 flex items-center justify-center disabled:opacity-0">
                        <ChevronRight className="w-5 h-5 text-white" />
                      </button>
                      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                        {mediaFiles.map((_, i) => (
                          <div key={i} className={cn('h-1.5 rounded-full transition-all', i === currentIndex ? 'w-4 bg-primary' : 'w-1.5 bg-white/60')} />
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-5 flex flex-col gap-4 min-w-0">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">Legenda</Label>
                <Textarea
                  placeholder="Escreve uma legenda, adiciona hashtags ou menciona pessoas…"
                  value={legenda} onChange={e => setLegenda(e.target.value)}
                  className="bg-secondary/50 border-border resize-none text-sm min-h-[100px] rounded-xl" maxLength={2200}
                />
                <div className="flex items-center justify-between">
                  <div className="flex gap-3 text-muted-foreground">
                    <button className="hover:text-foreground transition-colors"><Smile className="w-4 h-4" /></button>
                    <button className="hover:text-foreground transition-colors"><AtSign className="w-4 h-4" /></button>
                    <button className="hover:text-foreground transition-colors"><Hash className="w-4 h-4" /></button>
                  </div>
                  <span className={cn('text-xs', charCount > 2000 ? 'text-destructive' : 'text-muted-foreground')}>{charCount}/2200</span>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" /> Localização
                </Label>
                <Input placeholder="Luanda, Angola" value={localizacao} onChange={e => setLocalizacao(e.target.value)} className="bg-secondary/50 border-border text-sm rounded-xl" />
              </div>

              <div className="flex flex-col gap-2">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">Audiência</Label>
                <div className="grid grid-cols-3 gap-2">
                  {([{ value: 'todos', label: 'Todos' }, { value: 'seguidores', label: 'Seguidores' }, { value: 'subscritores', label: 'Subscritores' }] as const).map(opt => (
                    <button key={opt.value} onClick={() => { setAudiencia(opt.value); if (opt.value === 'subscritores') setExclusivo(true); else setExclusivo(false); }}
                      className={cn('py-2 px-3 rounded-xl text-xs font-semibold border transition-all', audiencia === opt.value ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-secondary/50 text-muted-foreground hover:border-primary/40')}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between py-3 border-t border-border">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center"><Lock className="w-4 h-4 text-primary" /></div>
                  <div>
                    <p className="text-sm font-semibold">Conteúdo exclusivo</p>
                    <p className="text-xs text-muted-foreground">Apenas subscritores ativos</p>
                  </div>
                </div>
                <Switch checked={exclusivo} onCheckedChange={v => { setExclusivo(v); if (v) setAudiencia('subscritores'); else setAudiencia('todos'); }} />
              </div>

              {exclusivo && (
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Preço de desbloqueio (Kz) — opcional</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">Kz</span>
                    <Input type="number" placeholder="ex: 2990" min={0} step={100} value={preco} onChange={e => setPreco(e.target.value)} className="bg-secondary/50 border-border text-sm rounded-xl pl-10" />
                  </div>
                  <p className="text-xs text-muted-foreground">Deixa vazio para mostrar apenas a subscritores ativos</p>
                </div>
              )}

              <div className="mt-auto pt-3 border-t border-border">
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="bg-secondary rounded-full px-2.5 py-1">{mediaFiles.length} {mediaFiles.length === 1 ? 'ficheiro' : 'ficheiros'}</span>
                  {mediaFiles.some(m => m.tipo === 'video') && <span className="bg-secondary rounded-full px-2.5 py-1 flex items-center gap-1"><Film className="w-3 h-3" /> Inclui vídeo</span>}
                  {exclusivo && <span className="bg-primary/10 text-primary rounded-full px-2.5 py-1 flex items-center gap-1"><Lock className="w-3 h-3" /> Exclusivo{preco && ` · ${Number(preco).toLocaleString('pt-PT')} Kz`}</span>}
                </div>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
