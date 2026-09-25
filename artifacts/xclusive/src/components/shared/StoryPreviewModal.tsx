import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Smile,
  Music2,
  Sparkles,
  ChevronDown,
  ArrowRight,
  Check,
  Star,
  Trash2,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { toast } from 'sonner';

/* ─── Types ─── */
interface TextLayer {
  id: string;
  text: string;
  x: number; // % from left
  y: number; // % from top
  color: string;
  bgColor: string;
  fontSize: number;
}

interface StoryPreviewModalProps {
  file: File;
  previewUrl: string;
  user: {
    id: number;
    username: string;
    nomeExibicao?: string | null;
    avatarUrl?: string | null;
  };
  onPublish: (file: File, legenda: string, audiencia?: 'todos' | 'proximos') => Promise<void>;
  onClose: () => void;
}

/* ─── Constants ─── */
const TEXT_COLORS = [
  '#FFFFFF',
  '#000000',
  '#FFDD00',
  '#FF4466',
  '#00C2FF',
  '#A855F7',
  '#10B981',
  '#F97316',
];

const TEXT_BG_COLORS = [
  'transparent',
  'rgba(0,0,0,0.65)',
  'rgba(255,255,255,0.92)',
  'rgba(255,68,102,0.85)',
  'rgba(124,58,237,0.85)',
  'rgba(16,185,129,0.85)',
];

const FILTERS = [
  { name: 'Normal', filter: 'none' },
  { name: 'Golden Hour', filter: 'contrast(1.1) brightness(1.05) saturate(1.2)' },
  { name: 'Luanda Warm', filter: 'sepia(0.25) saturate(1.3) contrast(1.05)' },
  { name: 'Preto & Branco', filter: 'grayscale(1) contrast(1.15)' },
  { name: 'Cyberpunk', filter: 'contrast(1.2) saturate(1.4) hue-rotate(15deg)' },
];

const QUICK_EMOJIS = ['😍', '🔥', '💎', '✨', '🎵', '❤️', '🙌', '💸', '👑', '🌟', '🎉', '🥰', '🇦🇴', '🏖️', '💯', '🚀'];

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/* ─── Canvas helper: bakes text and filter onto image ─── */
async function composeStoryImage(
  file: File,
  layers: TextLayer[],
  filterStyle: string,
  containerWidth: number,
  containerHeight: number
): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  if (layers.length === 0 && (!filterStyle || filterStyle === 'none')) return file;

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || 1080;
      canvas.height = img.naturalHeight || 1920;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(file);

      // Apply photo filter if present
      if (filterStyle && filterStyle !== 'none') {
        ctx.filter = filterStyle;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.filter = 'none'; // reset filter for text layers

      // Scale factor relative to preview container
      const scale = (canvas.width / containerWidth + canvas.height / containerHeight) / 2;

      for (const layer of layers) {
        if (!layer.text.trim()) continue;
        const x = (layer.x / 100) * canvas.width;
        const y = (layer.y / 100) * canvas.height;
        const fontSize = Math.max(20, Math.round(layer.fontSize * scale));

        ctx.save();
        ctx.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const lines = layer.text.split('\n');
        const lineHeight = fontSize * 1.25;
        const totalHeight = lines.length * lineHeight;

        let maxLineWidth = 0;
        for (const line of lines) {
          const w = ctx.measureText(line).width;
          if (w > maxLineWidth) maxLineWidth = w;
        }

        // Draw pill background
        if (layer.bgColor && layer.bgColor !== 'transparent') {
          ctx.fillStyle = layer.bgColor;
          const padX = fontSize * 0.45;
          const padY = fontSize * 0.35;
          const radius = fontSize * 0.35;
          const rectX = x - maxLineWidth / 2 - padX;
          const rectY = y - totalHeight / 2 - padY;
          const rectW = maxLineWidth + padX * 2;
          const rectH = totalHeight + padY * 2;

          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(rectX, rectY, rectW, rectH, radius);
          } else {
            ctx.rect(rectX, rectY, rectW, rectH);
          }
          ctx.fill();
        } else {
          ctx.shadowColor = 'rgba(0,0,0,0.85)';
          ctx.shadowBlur = fontSize * 0.25;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = fontSize * 0.05;
        }

        ctx.fillStyle = layer.color;
        const startY = y - ((lines.length - 1) * lineHeight) / 2;
        for (let i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], x, startY + i * lineHeight);
        }
        ctx.restore();
      }

      canvas.toBlob(
        (blob) => {
          if (!blob) return resolve(file);
          const composed = new File([blob], file.name.replace(/\.[^/.]+$/, '') + '_story.jpg', {
            type: 'image/jpeg',
            lastModified: Date.now(),
          });
          resolve(composed);
        },
        'image/jpeg',
        0.92
      );
    };
    img.onerror = () => resolve(file);
    img.src = URL.createObjectURL(file);
  });
}

/* ─── Main Component ─── */
export function StoryPreviewModal({ file, previewUrl, user, onPublish, onClose }: StoryPreviewModalProps) {
  const isVideo = file.type.startsWith('video/');
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  /* text layers */
  const [layers, setLayers] = useState<TextLayer[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [textColor, setTextColor] = useState(TEXT_COLORS[0]);
  const [textBg, setTextBg] = useState(TEXT_BG_COLORS[0]);
  const [fontSize, setFontSize] = useState(26);
  const [showTextPanel, setShowTextPanel] = useState(false);
  const textInputRef = useRef<HTMLTextAreaElement>(null);

  /* drag state */
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });

  /* filters */
  const [filterIndex, setFilterIndex] = useState(0);
  const currentFilter = FILTERS[filterIndex];

  /* caption & bottom input */
  const [legenda, setLegenda] = useState('');
  const [showCaptionInput, setShowCaptionInput] = useState(false);
  const legendaRef = useRef<HTMLInputElement>(null);

  /* emoji sheet */
  const [showEmoji, setShowEmoji] = useState(false);

  /* publishing states */
  const [isPublishing, setIsPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [publishedAudience, setPublishedAudience] = useState<'todos' | 'proximos'>('todos');

  /* Text mode handlers */
  function openNewTextLayer() {
    setEditingId(null);
    setEditingText('');
    setTextColor(TEXT_COLORS[0]);
    setTextBg(TEXT_BG_COLORS[0]);
    setFontSize(26);
    setShowTextPanel(true);
    setTimeout(() => textInputRef.current?.focus(), 120);
  }

  function commitText() {
    const trimmed = editingText.trim();
    if (!trimmed) {
      if (editingId) deleteLayer(editingId);
      setShowTextPanel(false);
      setEditingId(null);
      return;
    }

    if (editingId) {
      setLayers((prev) =>
        prev.map((l) =>
          l.id === editingId
            ? { ...l, text: trimmed, color: textColor, bgColor: textBg, fontSize }
            : l
        )
      );
    } else {
      setLayers((prev) => [
        ...prev,
        {
          id: uid(),
          text: trimmed,
          x: 50,
          y: 42,
          color: textColor,
          bgColor: textBg,
          fontSize,
        },
      ]);
    }

    setShowTextPanel(false);
    setEditingId(null);
    setEditingText('');
  }

  function startEditLayer(layer: TextLayer) {
    setEditingId(layer.id);
    setEditingText(layer.text);
    setTextColor(layer.color);
    setTextBg(layer.bgColor);
    setFontSize(layer.fontSize);
    setShowTextPanel(true);
    setTimeout(() => textInputRef.current?.focus(), 120);
  }

  function deleteLayer(id: string) {
    setLayers((prev) => prev.filter((l) => l.id !== id));
    if (editingId === id) {
      setShowTextPanel(false);
      setEditingId(null);
    }
  }

  /* Drag handlers with Pointer Events */
  const onPointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      if (showTextPanel) return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const layer = layers.find((l) => l.id === id);
      if (!layer) return;
      const layerPx = { x: (layer.x / 100) * rect.width, y: (layer.y / 100) * rect.height };
      dragOffset.current = { x: e.clientX - rect.left - layerPx.x, y: e.clientY - rect.top - layerPx.y };
      setDraggingId(id);
    },
    [layers, showTextPanel]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingId) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = Math.max(6, Math.min(94, ((e.clientX - rect.left - dragOffset.current.x) / rect.width) * 100));
      const y = Math.max(8, Math.min(88, ((e.clientY - rect.top - dragOffset.current.y) / rect.height) * 100));
      setLayers((prev) => prev.map((l) => (l.id === draggingId ? { ...l, x, y } : l)));
    },
    [draggingId]
  );

  const onPointerUp = useCallback(() => {
    setDraggingId(null);
  }, []);

  /* Filter cycle */
  function cycleFilter() {
    const nextIdx = (filterIndex + 1) % FILTERS.length;
    setFilterIndex(nextIdx);
    toast(`Filtro: ${FILTERS[nextIdx].name}`, { duration: 1500 });
  }

  /* Caption input auto-focus */
  useEffect(() => {
    if (showCaptionInput) {
      setTimeout(() => legendaRef.current?.focus(), 120);
    }
  }, [showCaptionInput]);

  /* Publish flow with visual confirmation */
  async function handlePublish(audiencia: 'todos' | 'proximos' = 'todos') {
    if (isPublishing || published) return;
    setIsPublishing(true);
    setPublishedAudience(audiencia);

    try {
      const rect = containerRef.current?.getBoundingClientRect();
      const containerW = rect?.width || 360;
      const containerH = rect?.height || 640;

      // Bake text & filter into image file
      const finalFile = await composeStoryImage(
        file,
        layers,
        currentFilter.filter,
        containerW,
        containerH
      );

      await onPublish(finalFile, legenda.trim(), audiencia);

      // Trigger published state with visual confirmation
      setPublished(true);

      // Keep success animation visible for 1s so the creator knows with 100% certainty that it posted
      setTimeout(() => {
        onClose();
      }, 1100);
    } catch (err) {
      console.error('[StoryPreviewModal] publish error:', err);
      setIsPublishing(false);
    }
  }

  /* Keyboard shortcut handling */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (showTextPanel) {
          setShowTextPanel(false);
          setEditingId(null);
        } else if (showCaptionInput) {
          setShowCaptionInput(false);
        } else if (showEmoji) {
          setShowEmoji(false);
        } else if (!isPublishing && !published) {
          onClose();
        }
      }
      if (e.key === 'Enter' && !e.shiftKey && showTextPanel) {
        e.preventDefault();
        commitText();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTextPanel, showCaptionInput, showEmoji, editingText, textColor, textBg, fontSize, isPublishing, published]);

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[120] flex items-center justify-center bg-black select-none"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        {/* Story Frame Container (Standard 9:16 mobile canvas) */}
        <div
          ref={containerRef}
          className="relative w-full h-full max-w-[420px] mx-auto overflow-hidden bg-black touch-none flex flex-col justify-between"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          {/* ── Background Media ── */}
          <div
            className="absolute inset-0 w-full h-full"
            style={{ filter: currentFilter.filter }}
          >
            {isVideo ? (
              <video
                ref={videoRef}
                src={previewUrl}
                className="w-full h-full object-cover"
                autoPlay
                loop
                muted
                playsInline
              />
            ) : (
              <img
                src={previewUrl}
                alt="Pré-visualização do Story"
                className="w-full h-full object-cover"
                draggable={false}
              />
            )}
          </div>

          {/* ── Subtle Vignette Gradients for Instagram Look ── */}
          <div className="absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-black/60 via-black/25 to-transparent pointer-events-none z-10" />
          <div className="absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-black/85 via-black/40 to-transparent pointer-events-none z-10" />

          {/* ── Text Layers Rendered Over Media ── */}
          {layers.map((layer) => (
            <motion.div
              key={layer.id}
              className="absolute z-20 cursor-grab active:cursor-grabbing touch-none select-none"
              style={{
                left: `${layer.x}%`,
                top: `${layer.y}%`,
                transform: 'translate(-50%, -50%)',
              }}
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{
                scale: draggingId === layer.id ? 1.05 : 1,
                opacity: 1,
              }}
              transition={{ type: 'spring', stiffness: 450, damping: 28 }}
              onPointerDown={(e) => onPointerDown(e, layer.id)}
              onClick={() => startEditLayer(layer)}
            >
              <div
                className="relative px-3 py-1.5 rounded-xl max-w-[280px] text-center break-words leading-tight font-bold tracking-tight shadow-xl"
                style={{
                  color: layer.color,
                  backgroundColor: layer.bgColor,
                  fontSize: `${layer.fontSize}px`,
                  textShadow:
                    layer.bgColor === 'transparent'
                      ? '0 2px 8px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.9)'
                      : 'none',
                  backdropFilter: layer.bgColor !== 'transparent' ? 'blur(6px)' : undefined,
                }}
              >
                {layer.text}
              </div>

              {/* Delete trigger button on layer */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteLayer(layer.id);
                }}
                className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-black/80 border border-white/20 text-white flex items-center justify-center opacity-80 hover:opacity-100 transition-opacity shadow-md"
              >
                <Trash2 className="w-3 h-3 text-red-400" />
              </button>
            </motion.div>
          ))}

          {/* ── TOP BAR (X on left, Aa on right) ── */}
          {!showTextPanel && !isPublishing && !published && (
            <div className="relative z-30 flex items-center justify-between px-4 pt-10 pb-2">
              {/* Close Button */}
              <button
                id="story-preview-close"
                type="button"
                onClick={onClose}
                className="w-10 h-10 rounded-full bg-black/45 backdrop-blur-md flex items-center justify-center border border-white/10 shadow-lg text-white hover:bg-black/65 active:scale-95 transition-all"
                title="Fechar e descartar"
              >
                <X className="w-5 h-5" />
              </button>

              {/* Text Tool Button ("Aa") */}
              <button
                id="story-preview-add-text"
                type="button"
                onClick={openNewTextLayer}
                className="w-10 h-10 rounded-full bg-black/45 backdrop-blur-md flex items-center justify-center border border-white/10 shadow-lg text-white hover:bg-black/65 active:scale-95 transition-all font-bold text-base"
                title="Adicionar texto"
              >
                Aa
              </button>
            </div>
          )}

          {/* ── RIGHT VERTICAL FLOATING BAR (Instagram stickers/music/effects) ── */}
          {!showTextPanel && !isPublishing && !published && (
            <div className="absolute right-4 top-28 flex flex-col items-center gap-3.5 z-30">
              {/* Stickers / Emoji Button */}
              <button
                id="story-preview-emoji"
                type="button"
                onClick={() => setShowEmoji((v) => !v)}
                className={cn(
                  'w-10 h-10 rounded-full bg-black/45 backdrop-blur-md flex items-center justify-center border border-white/10 shadow-lg text-white hover:bg-black/65 active:scale-95 transition-all',
                  showEmoji && 'bg-white text-black border-white'
                )}
                title="Figurinhas e Emojis"
              >
                <Smile className="w-5 h-5" />
              </button>

              {/* Music Tool */}
              <button
                id="story-preview-music"
                type="button"
                onClick={() => toast.info('Música de fundo nos stories estará disponível em breve!')}
                className="w-10 h-10 rounded-full bg-black/45 backdrop-blur-md flex items-center justify-center border border-white/10 shadow-lg text-white hover:bg-black/65 active:scale-95 transition-all"
                title="Música"
              >
                <Music2 className="w-5 h-5" />
              </button>

              {/* Effects / Filters */}
              <button
                id="story-preview-sparkles"
                type="button"
                onClick={cycleFilter}
                className={cn(
                  'w-10 h-10 rounded-full bg-black/45 backdrop-blur-md flex items-center justify-center border border-white/10 shadow-lg text-white hover:bg-black/65 active:scale-95 transition-all',
                  filterIndex > 0 && 'border-amber-400 text-amber-300'
                )}
                title={`Filtro: ${currentFilter.name}`}
              >
                <Sparkles className="w-5 h-5" />
              </button>

              {/* Chevron Down / More Options */}
              <button
                id="story-preview-more"
                type="button"
                onClick={() => {
                  toast('Opções adicionais', {
                    description: 'Podes arrastar o texto para qualquer posição e tocar em "Aa" para novo texto.',
                  });
                }}
                className="w-8 h-8 rounded-full bg-black/45 backdrop-blur-md flex items-center justify-center border border-white/10 shadow-lg text-white/80 hover:text-white hover:bg-black/65 active:scale-95 transition-all mt-1"
                title="Mais opções"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* ── STICKER & EMOJI PICKER POPUP ── */}
          <AnimatePresence>
            {showEmoji && !showTextPanel && (
              <motion.div
                className="absolute right-16 top-28 z-40 bg-black/80 backdrop-blur-2xl rounded-2xl p-3 border border-white/15 shadow-2xl grid grid-cols-4 gap-2 w-56"
                initial={{ opacity: 0, scale: 0.85, x: 12 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.85, x: 12 }}
              >
                {QUICK_EMOJIS.map((em) => (
                  <button
                    key={em}
                    type="button"
                    className="text-2xl hover:scale-130 active:scale-95 transition-transform w-10 h-10 flex items-center justify-center rounded-lg hover:bg-white/10"
                    onClick={() => {
                      setLayers((prev) => [
                        ...prev,
                        {
                          id: uid(),
                          text: em,
                          x: 50,
                          y: 50,
                          color: '#FFFFFF',
                          bgColor: 'transparent',
                          fontSize: 42,
                        },
                      ]);
                      setShowEmoji(false);
                    }}
                  >
                    {em}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── FULLSCREEN TEXT EDITOR OVERLAY ("Aa" Mode) ── */}
          <AnimatePresence>
            {showTextPanel && (
              <motion.div
                className="absolute inset-0 z-50 flex flex-col justify-between bg-black/65 backdrop-blur-md p-6"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {/* Header with Done button */}
                <div className="flex items-center justify-between pt-6">
                  <button
                    type="button"
                    onClick={() => {
                      setShowTextPanel(false);
                      setEditingId(null);
                    }}
                    className="text-white/80 hover:text-white text-sm font-semibold px-3 py-1.5"
                  >
                    Cancelar
                  </button>
                  <button
                    id="story-text-done"
                    type="button"
                    onClick={commitText}
                    className="px-5 py-1.5 bg-white text-black font-bold rounded-full text-sm shadow-lg hover:bg-white/90 active:scale-95 transition-all"
                  >
                    Concluído
                  </button>
                </div>

                {/* Central Textarea */}
                <div className="flex-1 flex items-center justify-center my-4">
                  <textarea
                    ref={textInputRef}
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    placeholder="Escreve aqui…"
                    rows={3}
                    className="bg-transparent border-none outline-none text-center resize-none w-full max-w-[320px] placeholder:text-white/40 leading-snug font-bold"
                    style={{
                      color: textColor,
                      backgroundColor: textBg,
                      fontSize: `${fontSize}px`,
                      borderRadius: '16px',
                      padding: '12px 18px',
                      textShadow:
                        textBg === 'transparent'
                          ? '0 2px 8px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.9)'
                          : 'none',
                    }}
                  />
                </div>

                {/* Styling Tools (Colors, Background Style, Size) */}
                <div className="flex flex-col gap-3 pb-8">
                  {/* Text Color Swatches */}
                  <div className="flex items-center justify-center gap-2.5 overflow-x-auto py-1">
                    {TEXT_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={cn(
                          'w-7 h-7 rounded-full border-2 transition-all shrink-0',
                          textColor === c
                            ? 'scale-125 border-white shadow-[0_0_10px_rgba(255,255,255,0.8)]'
                            : 'border-white/30 hover:scale-110'
                        )}
                        style={{ backgroundColor: c }}
                        onClick={() => setTextColor(c)}
                      />
                    ))}
                  </div>

                  {/* Text Background Mode Swatches */}
                  <div className="flex items-center justify-center gap-2">
                    <span className="text-[11px] text-white/60 font-medium mr-1">Fundo:</span>
                    {TEXT_BG_COLORS.map((bg, idx) => (
                      <button
                        key={idx}
                        type="button"
                        className={cn(
                          'w-6 h-6 rounded-md border-2 transition-all',
                          textBg === bg
                            ? 'scale-125 border-white shadow-md'
                            : 'border-white/20 hover:scale-110'
                        )}
                        style={{
                          background:
                            bg === 'transparent'
                              ? 'repeating-conic-gradient(#555 0% 25%, #222 0% 50%) 0 0 / 8px 8px'
                              : bg,
                        }}
                        onClick={() => setTextBg(bg)}
                      />
                    ))}
                  </div>

                  {/* Font Size Slider */}
                  <div className="flex items-center justify-center gap-3 px-6 mt-1">
                    <span className="text-white/60 text-xs font-semibold">aA</span>
                    <input
                      type="range"
                      min={18}
                      max={48}
                      step={2}
                      value={fontSize}
                      onChange={(e) => setFontSize(Number(e.target.value))}
                      className="w-48 accent-white cursor-pointer"
                    />
                    <span className="text-white text-base font-bold">Aa</span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── BOTTOM AREA: CAPTION INPUT & INSTAGRAM ACTION BUTTONS ── */}
          {!showTextPanel && !isPublishing && !published && (
            <div className="relative z-30 pb-6 pt-2">
              {/* Caption Bar ("Adiciona uma legenda…") */}
              <div className="px-4 mb-3">
                <AnimatePresence mode="wait">
                  {showCaptionInput ? (
                    <motion.div
                      key="caption-input"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 8 }}
                      className="flex items-center gap-2 bg-black/60 backdrop-blur-md rounded-2xl border border-white/20 px-3.5 py-2 shadow-lg"
                    >
                      <input
                        ref={legendaRef}
                        value={legenda}
                        onChange={(e) => setLegenda(e.target.value)}
                        placeholder="Adiciona uma legenda…"
                        maxLength={220}
                        className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-white/50 text-sm font-medium"
                        onBlur={() => {
                          if (!legenda.trim()) setShowCaptionInput(false);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            setShowCaptionInput(false);
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowCaptionInput(false)}
                        className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 text-white"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    </motion.div>
                  ) : (
                    <motion.button
                      key="caption-trigger"
                      id="story-preview-caption"
                      type="button"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 8 }}
                      onClick={() => setShowCaptionInput(true)}
                      className="w-full text-left text-white/75 text-sm font-medium py-1 px-1 hover:text-white transition-colors truncate drop-shadow-md"
                    >
                      {legenda ? (
                        <span className="text-white font-medium bg-black/40 px-2.5 py-1 rounded-lg backdrop-blur-sm border border-white/10">
                          {legenda}
                        </span>
                      ) : (
                        'Adiciona uma legenda…'
                      )}
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>

              {/* Action Buttons Row (Exact match to Instagram screenshot) */}
              <div className="flex items-center gap-2.5 px-4">
                {/* 1. "As tuas histórias" Pill */}
                <button
                  id="story-preview-publish-main"
                  type="button"
                  onClick={() => handlePublish('todos')}
                  disabled={isPublishing}
                  className="flex-1 flex items-center gap-2 bg-black/55 backdrop-blur-md rounded-full border border-white/15 px-2.5 py-2 shadow-lg hover:bg-black/75 active:scale-98 transition-all overflow-hidden"
                  title="Publicar na Tua História"
                >
                  <div className="relative shrink-0">
                    <Avatar className="w-7 h-7 border border-white/30">
                      <AvatarImage src={user.avatarUrl || ''} />
                      <AvatarFallback className="bg-primary text-white text-[10px] font-bold">
                        {(user.nomeExibicao || user.username)?.[0]?.toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    {/* Small blue badge on avatar corner */}
                    <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-[#0095f6] border border-black flex items-center justify-center">
                      <span className="text-white text-[8px] font-bold">+</span>
                    </div>
                  </div>
                  <span className="text-white text-xs font-semibold truncate">
                    As tuas histór…
                  </span>
                </button>

                {/* 2. "Amigos Chegados" Pill */}
                <button
                  id="story-preview-close-friends"
                  type="button"
                  onClick={() => handlePublish('proximos')}
                  disabled={isPublishing}
                  className="flex-1 flex items-center gap-2 bg-black/55 backdrop-blur-md rounded-full border border-white/15 px-2.5 py-2 shadow-lg hover:bg-black/75 active:scale-98 transition-all overflow-hidden"
                  title="Publicar para Amigos Chegados / Subscritores"
                >
                  <div className="w-7 h-7 rounded-full bg-[#10b981] flex items-center justify-center shrink-0 shadow-sm">
                    <Star className="w-3.5 h-3.5 text-white fill-white" />
                  </div>
                  <span className="text-white text-xs font-semibold truncate">
                    Amigos Che…
                  </span>
                </button>

                {/* 3. Blue Circular Forward Button */}
                <button
                  id="story-preview-send"
                  type="button"
                  onClick={() => handlePublish('todos')}
                  disabled={isPublishing}
                  className="w-11 h-11 rounded-full bg-[#0095f6] hover:bg-[#1877f2] active:scale-95 flex items-center justify-center shadow-xl transition-all shrink-0"
                  title="Publicar Story"
                >
                  <ArrowRight className="w-5 h-5 text-white" />
                </button>
              </div>
            </div>
          )}

          {/* ── PUBLISHING & SUCCESS CONFIRMATION OVERLAY ── */}
          {/* This guarantees the user clearly knows the story is posting and has posted! */}
          <AnimatePresence>
            {(isPublishing || published) && (
              <motion.div
                className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/85 backdrop-blur-md px-6 text-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {isPublishing && !published && (
                  <motion.div
                    className="flex flex-col items-center gap-4"
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                  >
                    <div className="relative w-16 h-16 flex items-center justify-center">
                      <div className="absolute inset-0 rounded-full border-4 border-white/20" />
                      <div className="absolute inset-0 rounded-full border-4 border-t-primary border-r-transparent border-b-transparent border-l-transparent animate-spin" />
                      <Avatar className="w-10 h-10 border border-white/30">
                        <AvatarImage src={user.avatarUrl || ''} />
                        <AvatarFallback className="bg-primary text-white text-xs font-bold">
                          {(user.nomeExibicao || user.username)?.[0]?.toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    </div>
                    <div className="space-y-1">
                      <p className="text-white font-bold text-base">A partilhar história…</p>
                      <p className="text-white/60 text-xs">A otimizar e enviar o teu story</p>
                    </div>
                  </motion.div>
                )}

                {published && (
                  <motion.div
                    className="flex flex-col items-center gap-4"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 350, damping: 20 }}
                  >
                    <div className="w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center shadow-[0_0_30px_rgba(16,185,129,0.5)]">
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: 0.1, type: 'spring', stiffness: 400 }}
                      >
                        <Check className="w-10 h-10 text-emerald-400 stroke-[3]" />
                      </motion.div>
                    </div>
                    <div className="space-y-1.5">
                      <h3 className="text-white font-extrabold text-xl">Story Publicado!</h3>
                      <p className="text-white/80 text-sm max-w-[260px]">
                        {publishedAudience === 'proximos'
                          ? 'A tua história já está visível para os Amigos Chegados.'
                          : 'A tua história já está visível para os teus seguidores.'}
                      </p>
                    </div>
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
