import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export interface DadosEnquete { pergunta: string; opcoes: string[]; duracaoDias: 1 | 3 | 7; audiencia: 'todos' | 'seguidores' }

const MAX_PERGUNTA = 2200;
const MAX_OPCAO = 60;
const chave = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const grupo = (ativo: boolean) => cn(
  'min-h-[44px] rounded-xl border px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
  ativo ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-secondary/50 text-muted-foreground hover:border-primary/40',
);

/** Formulário de criação da enquete: pergunta, 2 a 4 opções (até 60 caracteres), duração (1, 3 ou 7 dias) e quem pode votar. */
export function FormularioEnquete({ aPublicar, onPublicar }: { aPublicar: boolean; onPublicar: (d: DadosEnquete) => void }) {
  const [pergunta, setPergunta] = useState('');
  const [opcoes, setOpcoes] = useState<string[]>(['', '']);
  const [dias, setDias] = useState<1 | 3 | 7>(1);
  const [audiencia, setAudiencia] = useState<'todos' | 'seguidores'>('todos');

  const limpas = opcoes.map((o) => o.trim());
  const repetidas = useMemo(() => new Set(limpas.filter(Boolean).map(chave)).size !== limpas.filter(Boolean).length, [limpas]);
  const valida = pergunta.trim().length > 0 && limpas.length >= 2 && limpas.every((o) => o.length > 0) && !repetidas;

  const mudar = (i: number, v: string) => setOpcoes((os) => os.map((o, k) => (k === i ? v.slice(0, MAX_OPCAO) : o)));

  return (
    <form className="flex flex-col gap-5 p-4 sm:p-5" onSubmit={(e) => { e.preventDefault(); if (valida && !aPublicar) onPublicar({ pergunta: pergunta.trim(), opcoes: limpas, duracaoDias: dias, audiencia }); }} data-testid="enquete-formulario">
      <div className="flex flex-col gap-2">
        <label htmlFor="enquete-pergunta" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pergunta</label>
        <Textarea id="enquete-pergunta" value={pergunta} onChange={(e) => setPergunta(e.target.value.slice(0, MAX_PERGUNTA))} maxLength={MAX_PERGUNTA} placeholder="Faz uma pergunta"
          className="min-h-[88px] resize-none text-base" data-testid="enquete-pergunta" />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Opções (2 a 4)</legend>
        {opcoes.map((o, i) => (
          <div key={i} className="flex items-center gap-2">
            <input value={o} onChange={(e) => mudar(i, e.target.value)} maxLength={MAX_OPCAO} aria-label={`Opção ${i + 1}`} placeholder={`Opção ${i + 1}`} data-testid="enquete-opcao-campo"
              className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-transparent px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground" aria-hidden="true">{MAX_OPCAO - o.length}</span>
            {opcoes.length > 2 && (
              <button type="button" onClick={() => setOpcoes((os) => os.filter((_, k) => k !== i))} aria-label={`Remover opção ${i + 1}`} data-testid="enquete-remover-opcao"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="h-4 w-4" aria-hidden="true" /></button>
            )}
          </div>
        ))}
        {opcoes.length < 4 && (
          <button type="button" onClick={() => setOpcoes((os) => [...os, ''])} data-testid="enquete-adicionar-opcao"
            className="flex min-h-[44px] items-center gap-2 self-start rounded-xl px-3 text-sm font-semibold text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Plus className="h-4 w-4" aria-hidden="true" /> Adicionar opção</button>
        )}
        {repetidas && <p role="alert" className="text-xs font-medium text-destructive" data-testid="enquete-erro-repetidas">As opções não podem ser repetidas.</p>}
      </fieldset>

      <div className="flex flex-col gap-2">
        <span id="enquete-duracao" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Duração</span>
        <div role="group" aria-labelledby="enquete-duracao" className="grid grid-cols-3 gap-2">
          {([1, 3, 7] as const).map((d) => (
            <button key={d} type="button" aria-pressed={dias === d} onClick={() => setDias(d)} className={grupo(dias === d)} data-testid={`enquete-duracao-${d}`}>{d} {d === 1 ? 'dia' : 'dias'}</button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span id="enquete-quem" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quem pode votar</span>
        <div role="group" aria-labelledby="enquete-quem" className="grid grid-cols-2 gap-2">
          <button type="button" aria-pressed={audiencia === 'todos'} onClick={() => setAudiencia('todos')} className={grupo(audiencia === 'todos')} data-testid="enquete-aud-todos">Todos</button>
          <button type="button" aria-pressed={audiencia === 'seguidores'} onClick={() => setAudiencia('seguidores')} className={grupo(audiencia === 'seguidores')} data-testid="enquete-aud-seguidores">Só seguidores</button>
        </div>
      </div>

      <Button type="submit" disabled={!valida || aPublicar} className="min-h-[44px] rounded-xl bg-primary/10 font-bold text-primary hover:bg-primary/20" data-testid="enquete-publicar">
        {aPublicar ? 'A publicar…' : 'Publicar enquete'}
      </Button>
    </form>
  );
}
