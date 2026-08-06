import { useRef, useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useCreatePost } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Image, Film, Type, Send, X, Smile, Hash, AtSign } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

interface InlineComposerProps {
  user: {
    id: number;
    username: string;
    nomeExibicao: string | null;
    avatarUrl: string | null;
  };
  /** Called when the user selects files — parent opens the full modal with those files */
  onOpenWithFiles: (files: File[]) => void;
}

const MAX_TEXTO = 2200;
const MAX_SIZE_MB = 100;

export function InlineComposer({ user, onOpenWithFiles }: InlineComposerProps) {
  const queryClient = useQueryClient();
  const { mutate: createPost, isPending } = useCreatePost();

  const [expanded, setExpanded] = useState(false);
  const [texto, setTexto] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const remaining = MAX_TEXTO - texto.length;
  const canSubmit = texto.trim().length > 0 && !isPending;

  function handleFocus() {
    setExpanded(true);
  }

  function handleDiscard() {
    setTexto('');
    setExpanded(false);
    textareaRef.current?.blur();
  }

  function handleSubmit() {
    if (!canSubmit) return;
    createPost(
      { data: { legenda: texto.trim(), tipo: 'texto' as any } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['/api/feed'] });
          toast.success('Publicação criada!');
          handleDiscard();
        },
        onError: () => toast.error('Erro ao publicar. Tenta novamente.'),
      }
    );
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length) return;

    const valid = files.filter(f => {
      if (!f.type.startsWith('image/') && !f.type.startsWith('video/')) {
        toast.error(`"${f.name}" não é suportado.`);
        return false;
      }
      if (f.size > MAX_SIZE_MB * 1024 * 1024) {
        toast.error(`"${f.name}" é demasiado grande. Máx ${MAX_SIZE_MB}MB.`);
        return false;
      }
      return true;
    });

    if (valid.length > 0) onOpenWithFiles(valid);
  }

  function handleTextButtonClick() {
    setExpanded(true);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  return (
    <div className={cn(
      'bg-card border border-border rounded-2xl mb-6 transition-all duration-200',
      expanded ? 'shadow-lg' : 'shadow-none',
    )}>
      {/* Top row: avatar + input */}
      <div className="flex items-start gap-3 p-4">
        <Avatar className="w-9 h-9 shrink-0 mt-0.5 border border-border">
          <AvatarImage src={user.avatarUrl || ''} />
          <AvatarFallback>{user.nomeExibicao?.[0] || user.username[0]}</AvatarFallback>
        </Avatar>

        <div className="flex-1 min-w-0">
          <Textarea
            ref={textareaRef}
            placeholder="Criar nova publicação..."
            value={texto}
            onChange={e => setTexto(e.target.value.slice(0, MAX_TEXTO))}
            onFocus={handleFocus}
            rows={expanded ? 4 : 1}
            className={cn(
              'w-full bg-transparent border-none shadow-none resize-none p-0 text-[15px]',
              'placeholder:text-muted-foreground/60 focus-visible:ring-0',
              'leading-relaxed transition-all duration-200',
              expanded ? 'min-h-[80px]' : 'min-h-[24px] overflow-hidden',
            )}
          />
        </div>

        {/* Discard button (only when expanded with text) */}
        <AnimatePresence>
          {expanded && texto && (
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              onClick={handleDiscard}
              className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors mt-0.5"
            >
              <X className="w-4 h-4" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Expanded: char counter + toolbar */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            {/* Extra tools row */}
            <div className="flex items-center gap-2 px-4 pb-1 text-muted-foreground">
              <button className="hover:text-foreground transition-colors p-1 rounded-md hover:bg-secondary" title="Emoji">
                <Smile className="w-4 h-4" />
              </button>
              <button className="hover:text-foreground transition-colors p-1 rounded-md hover:bg-secondary" title="Mencionar">
                <AtSign className="w-4 h-4" />
              </button>
              <button className="hover:text-foreground transition-colors p-1 rounded-md hover:bg-secondary" title="Hashtag">
                <Hash className="w-4 h-4" />
              </button>
              <div className="flex-1" />
              {/* Char counter ring */}
              <div className="relative w-7 h-7">
                <svg className="w-7 h-7 -rotate-90" viewBox="0 0 28 28">
                  <circle cx="14" cy="14" r="11" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-border" />
                  <circle
                    cx="14" cy="14" r="11" fill="none" strokeWidth="2.5"
                    stroke="currentColor"
                    strokeDasharray={`${2 * Math.PI * 11}`}
                    strokeDashoffset={`${2 * Math.PI * 11 * (1 - texto.length / MAX_TEXTO)}`}
                    className={remaining <= 20 ? 'text-destructive' : remaining <= 100 ? 'text-yellow-500' : 'text-primary'}
                    strokeLinecap="round"
                  />
                </svg>
                {remaining <= 100 && (
                  <span className={cn(
                    'absolute inset-0 flex items-center justify-center text-[9px] font-bold',
                    remaining <= 20 ? 'text-destructive' : 'text-muted-foreground',
                  )}>
                    {remaining}
                  </span>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Divider */}
      <div className="mx-4 border-t border-border" />

      {/* Bottom action bar */}
      <div className="flex items-center gap-1 px-3 py-2.5">
        {/* File picker: foto/vídeo */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-secondary transition-all text-sm font-medium"
          title="Foto / Vídeo"
        >
          <Image className="w-5 h-5 text-green-500" />
          <span className="hidden sm:inline text-xs">Foto/Vídeo</span>
        </button>

        <button
          onClick={() => { fileInputRef.current?.click(); }}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-secondary transition-all text-sm font-medium"
          title="Vídeo"
        >
          <Film className="w-5 h-5 text-red-500" />
          <span className="hidden sm:inline text-xs">Reel</span>
        </button>

        <button
          onClick={handleTextButtonClick}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-secondary transition-all text-sm font-medium"
          title="Publicação de texto"
        >
          <Type className="w-5 h-5 text-primary" />
          <span className="hidden sm:inline text-xs">Texto</span>
        </button>

        {/* Submit — appears when there's text */}
        <AnimatePresence>
          {texto.trim() && (
            <motion.div
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              className="ml-auto"
            >
              <Button
                size="sm"
                className="bg-primary hover:bg-primary/90 text-white h-8 px-4 rounded-xl font-semibold gap-1.5 text-xs"
                onClick={handleSubmit}
                disabled={!canSubmit}
              >
                {isPending ? (
                  <span>A publicar…</span>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    Publicar
                  </>
                )}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
