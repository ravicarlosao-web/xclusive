import { useState } from 'react';
import { Link } from 'wouter';
import { Loader2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RenovarDialog, CancelarDialog } from '@/components/subscricoes/AcoesSubscricao';
import { useMinhasSubscricoes } from '@/hooks/useMinhasSubscricoes';
import { formatarData, kz, type MinhaSubscricao } from '@/lib/subscricoes';

function Linha({ sub, onRenovar, onCancelar }: { sub: MinhaSubscricao; onRenovar: () => void; onCancelar: () => void }) {
  const nome = sub.criador.nomeExibicao || sub.criador.username;
  const estadoRotulo = sub.estado === 'expirada' ? 'Expirada' : sub.estado === 'cancelada' ? 'Cancelada' : 'Ativa';
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-xl border border-border bg-card" data-testid={`sub-${sub.criador.username}`}>
      <Link href={`/perfil/${sub.criador.username}`} className="flex items-center gap-3 flex-1 min-w-0">
        <Avatar className="w-11 h-11 border border-border">
          <AvatarImage src={sub.criador.avatarUrl || ''} />
          <AvatarFallback>{sub.criador.username[0]?.toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="font-bold truncate">{nome}</p>
          <p className="text-xs text-muted-foreground truncate">
            @{sub.criador.username}
            {sub.plano ? ` · ${sub.plano.nome}` : sub.gratuita ? ' · Gratuita' : ''}
            {sub.preco != null && !sub.gratuita ? ` · ${kz(sub.preco)}/mês` : ''}
          </p>
          <p className="text-xs text-muted-foreground" data-testid="sub-data">
            {sub.temAcesso && sub.acessoAte && <>{sub.estado === 'cancelada' ? 'Acesso até' : 'Válida até'} {formatarData(sub.acessoAte)}</>}
            {sub.temAcesso && !sub.acessoAte && 'Sem data de fim'}
            {!sub.temAcesso && sub.terminouEm && <>Terminou em {formatarData(sub.terminouEm)}</>}
            {!sub.temAcesso && !sub.terminouEm && 'Terminou'}
          </p>
        </div>
      </Link>
      <div className="flex items-center gap-2 sm:justify-end">
        <Badge variant={sub.estado === 'ativa' ? 'default' : 'secondary'} data-testid="sub-estado">{estadoRotulo}</Badge>
        {sub.podeRenovar && (
          <Button size="sm" onClick={onRenovar} data-testid="sub-renovar">
            {sub.estado === 'ativa' ? 'Renovar' : sub.estado === 'cancelada' ? 'Reativar' : 'Renovar'}
          </Button>
        )}
        {sub.estado === 'ativa' && (
          <Button size="sm" variant="outline" onClick={onCancelar} data-testid="sub-cancelar">Cancelar</Button>
        )}
      </div>
    </div>
  );
}

/** Definições › Subscrições: as minhas subscrições (estado real do servidor), com renovar e cancelar. */
export function MinhasSubscricoes() {
  const { subscricoes, isLoading, isError, mock, refetch } = useMinhasSubscricoes();
  const [renovar, setRenovar] = useState<MinhaSubscricao | null>(null);
  const [cancelar, setCancelar] = useState<MinhaSubscricao | null>(null);

  if (mock) {
    return <p className="text-sm text-muted-foreground">As subscrições estão disponíveis com a conta real (não em modo de demonstração).</p>;
  }
  const comAcesso = subscricoes.filter((s) => s.temAcesso);
  const terminadas = subscricoes.filter((s) => !s.temAcesso);

  return (
    <div className="space-y-6" data-testid="minhas-subscricoes">
      <h2 className="text-xl font-bold">As minhas subscrições</h2>
      {isLoading && <div className="flex items-center text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin mr-2" /> A carregar…</div>}
      {isError && (
        <div className="text-sm text-muted-foreground">
          Não foi possível carregar as subscrições.{' '}
          <button className="underline" onClick={() => refetch()}>Tentar de novo</button>
        </div>
      )}
      {!isLoading && !isError && subscricoes.length === 0 && (
        <p className="text-sm text-muted-foreground" data-testid="sem-subscricoes">Ainda não subscreveste nenhum criador.</p>
      )}
      {comAcesso.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Com acesso</h3>
          {comAcesso.map((s) => <Linha key={s.id} sub={s} onRenovar={() => setRenovar(s)} onCancelar={() => setCancelar(s)} />)}
        </section>
      )}
      {terminadas.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Terminadas</h3>
          {terminadas.map((s) => <Linha key={s.id} sub={s} onRenovar={() => setRenovar(s)} onCancelar={() => setCancelar(s)} />)}
        </section>
      )}
      <RenovarDialog sub={renovar} open={!!renovar} onClose={() => { setRenovar(null); void refetch(); }} />
      <CancelarDialog sub={cancelar} open={!!cancelar} onClose={() => { setCancelar(null); void refetch(); }} />
    </div>
  );
}
