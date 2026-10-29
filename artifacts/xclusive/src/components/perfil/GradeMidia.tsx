import { useEffect, useRef, useState } from 'react';
import { Image as ImagemIcone, Lock, Play, Video } from 'lucide-react';
import type { Post } from '@workspace/api-client-react';
import { cn } from '@/lib/utils';

export type FiltroMidia = 'tudo' | 'foto' | 'video';

/** Publicações com ficheiros (os de texto não entram). O primeiro ficheiro decide o filtro Foto/Vídeo. */
export function temMidia(p: Post): boolean { return (p.media?.length ?? 0) > 0; }
export function passaFiltro(p: Post, f: FiltroMidia): boolean {
  if (f === 'tudo') return true;
  const t = p.media?.[0]?.tipo;
  return f === 'foto' ? t === 'imagem' : t === 'video';
}

/** Mostra o vídeo (primeiro fotograma) só quando a célula está à vista: evita pedir dezenas de ficheiros de uma vez. */
function useNoEcra<T extends Element>() {
  const ref = useRef<T | null>(null);
  const [visto, setVisto] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || visto) return;
    if (typeof IntersectionObserver === 'undefined') { setVisto(true); return; }
    const o = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setVisto(true); o.disconnect(); } }, { rootMargin: '200px' });
    o.observe(el);
    return () => o.disconnect();
  }, [visto]);
  return { ref, visto };
}

function rotuloAcessivel(p: Post, bloqueada: boolean): string {
  const n = p.media?.length ?? 0;
  if (bloqueada) return 'Abrir publicação, conteúdo exclusivo';
  const t = p.media?.[0]?.tipo;
  return `Abrir publicação, ${n} ${t === 'video' ? (n === 1 ? 'vídeo' : 'vídeos') : (n === 1 ? 'foto' : 'fotos')}`;
}

/**
 * Uma célula quadrada por publicação com ficheiros. Bloqueada (exclusiva sem acesso ou sem URL): célula neutra com cadeado e
 * NENHUMA URL de media. Vídeo: primeiro fotograma (não há poster no payload) e, se falhar, célula neutra com play.
 */
export function CelulaMidia({ post, onAbrir }: { post: Post; onAbrir: (p: Post) => void }) {
  const primeiro = post.media?.[0];
  const bloqueada = !!post.bloqueado || !primeiro?.url;
  const { ref, visto } = useNoEcra<HTMLButtonElement>();
  const [falhou, setFalhou] = useState(false);
  const n = post.media?.length ?? 0;
  const ehVideo = primeiro?.tipo === 'video';
  return (
    <button ref={ref} type="button" onClick={() => onAbrir(post)} aria-label={rotuloAcessivel(post, bloqueada)} data-testid="midia-celula"
      className="group relative aspect-square w-full overflow-hidden bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
      {bloqueada ? (
        <span className="absolute inset-0 flex items-center justify-center text-muted-foreground" data-testid="midia-bloqueada"><Lock className="h-7 w-7" aria-hidden="true" /></span>
      ) : falhou ? (
        <span className="absolute inset-0 flex items-center justify-center text-muted-foreground">{ehVideo ? <Play className="h-7 w-7" aria-hidden="true" /> : <ImagemIcone className="h-7 w-7" aria-hidden="true" />}</span>
      ) : ehVideo ? (
        visto ? <video src={`${primeiro!.url}#t=0.1`} muted playsInline preload="metadata" className="h-full w-full object-cover" onError={() => setFalhou(true)} /> : <span className="absolute inset-0 flex items-center justify-center text-muted-foreground"><Play className="h-7 w-7" aria-hidden="true" /></span>
      ) : (
        <img src={primeiro!.url ?? ''} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" onError={() => setFalhou(true)} />
      )}
      <span className="pointer-events-none absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/20 motion-reduce:transition-none" aria-hidden="true" />
      {!bloqueada && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/55 to-transparent px-1.5 pb-1 pt-4 text-xs font-semibold text-white" aria-hidden="true">
          {ehVideo ? <Video className="h-3.5 w-3.5" /> : <ImagemIcone className="h-3.5 w-3.5" />}{n}
        </span>
      )}
    </button>
  );
}

export function GradeMidia({ posts, onAbrir }: { posts: Post[]; onAbrir: (p: Post) => void }) {
  return (
    <div className="grid grid-cols-3 gap-[2px] bg-background" data-testid="midia-grade">
      {posts.map((p) => <CelulaMidia key={p.id} post={p} onAbrir={onAbrir} />)}
    </div>
  );
}

export function GradeEsqueleto() {
  return (
    <div className="grid grid-cols-3 gap-[2px] bg-background" data-testid="midia-esqueleto" aria-hidden="true">
      {Array.from({ length: 12 }, (_, i) => <div key={i} className="aspect-square w-full animate-pulse bg-secondary motion-reduce:animate-none" />)}
    </div>
  );
}

const ROTULOS: Record<FiltroMidia, string> = { tudo: 'Tudo', foto: 'Foto', video: 'Vídeo' };
/** Chips de filtro (sem contagens: o servidor não devolve totais de fotos/vídeos). */
export function FiltrosMidia({ filtro, onMudar }: { filtro: FiltroMidia; onMudar: (f: FiltroMidia) => void }) {
  return (
    <div className="flex gap-2 border-b border-border px-4 py-3" role="group" aria-label="Filtrar mídia" data-testid="midia-filtros">
      {(Object.keys(ROTULOS) as FiltroMidia[]).map((f) => (
        <button key={f} type="button" aria-pressed={filtro === f} onClick={() => onMudar(f)} data-testid={`midia-filtro-${f}`}
          className={cn('min-h-[44px] rounded-full px-5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
            filtro === f ? 'bg-primary/10 font-bold text-primary' : 'bg-secondary text-muted-foreground hover:text-foreground')}>{ROTULOS[f]}</button>
      ))}
    </div>
  );
}
