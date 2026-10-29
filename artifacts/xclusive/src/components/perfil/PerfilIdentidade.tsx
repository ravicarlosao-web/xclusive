import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { Radio } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

/** Botão redondo só com ícone (alvo de toque de 44 px) e nome acessível. */
export function BotaoRedondo({ rotulo, children, onClick, href, ativo, destaque, desativado, testid }: {
  rotulo: string; children: ReactNode; onClick?: () => void; href?: string; ativo?: boolean; destaque?: 'primario' | 'live'; desativado?: boolean; testid?: string;
}) {
  const cls = cn(
    'flex h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
    destaque === 'primario' && 'border-primary bg-primary text-primary-foreground hover:bg-primary/90',
    destaque === 'live' && 'animate-pulse border-red-600 bg-red-600 text-white hover:bg-red-700',
    !destaque && 'border-border bg-background text-foreground hover:bg-secondary',
  );
  if (href) return <Link href={href} aria-label={rotulo} title={rotulo} className={cls} data-testid={testid}>{children}</Link>;
  return <button type="button" aria-label={rotulo} title={rotulo} aria-pressed={ativo} onClick={onClick} disabled={desativado} className={cls} data-testid={testid}>{children}</button>;
}

/** Avatar sobreposto à base do banner (anel do tema), ações redondas à direita, e por baixo nome, @handle, bio e ligação. */
export function PerfilIdentidade({ nome, username, avatarUrl, verificado, bio, link, aoVivo, acoes }: {
  nome: string; username: string; avatarUrl?: string | null; verificado: boolean; bio?: string | null; link?: string | null; aoVivo: boolean; acoes: ReactNode;
}) {
  return (
    <div className="px-4 pb-4">
      <div className="flex items-end justify-between gap-3">
        <Avatar className="-mt-10 h-20 w-20 shrink-0 border-0 ring-4 ring-background sm:-mt-12 sm:h-24 sm:w-24" data-testid="perfil-avatar">
          <AvatarImage src={avatarUrl || ''} alt="" className="object-cover" />
          <AvatarFallback className="text-3xl">{nome[0]}</AvatarFallback>
        </Avatar>
        <div className="flex flex-wrap items-center justify-end gap-2 pt-2" data-testid="perfil-acoes">{acoes}</div>
      </div>

      <h1 className="mt-3 flex items-center gap-2 text-xl font-bold sm:text-2xl" data-testid="perfil-nome">
        <span className="min-w-0 truncate">{nome}</span>
        {verificado && <svg className="h-5 w-5 shrink-0 fill-current text-primary" viewBox="0 0 24 24" role="img" aria-label="Verificado"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-1.9 14.7L6 12.6l1.5-1.5 2.6 2.6 6.4-6.4 1.5 1.5-7.9 7.9z" /></svg>}
        {aoVivo && <span className="inline-flex shrink-0 animate-pulse items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white"><Radio className="h-3 w-3" aria-hidden="true" />AO VIVO</span>}
      </h1>
      <p className="font-medium text-muted-foreground">@{username}</p>
      {bio && <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed">{bio}</p>}
      {link && (
        <a href={link} target="_blank" rel="noopener noreferrer" className="mt-3 flex items-center gap-2 text-sm font-medium text-primary hover:underline">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
          {link.replace(/^https?:\/\//, '')}
        </a>
      )}
    </div>
  );
}
