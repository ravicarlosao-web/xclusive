import { useRef, useState } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { customFetch, type Conversation } from '@workspace/api-client-react';

/**
 * Lista de conversas com «carregar mais» (paginação por cursor = posição (última atividade, id) da última conversa recebida).
 *  - CABEÇA: as 20 mais recentes, pedida a GET /api/conversations?cursor=&limite=20. É a única parte que se atualiza sozinha (poll de 30 s, quando `poll`).
 *  - EXTRAS: as páginas seguintes, guardadas à parte na cache (chave `CHAVE_EXTRAS`) e NUNCA recarregadas pelo poll: o poll não apaga o que já foi
 *    carregado nem faz saltar a lista. Uma conversa com atividade nova sobe sozinha para a cabeça; a cópia antiga nos extras fica escondida (união por id).
 *  - CONTINUIDADE (ver `reconciliar`): as conversas empurradas para fora da cabeça passam para os extras; se a cabeça nova não tem nenhuma conversa
 *    conhecida e inalterada (mais de uma página de atividade entre dois polls) os extras são descartados e a pessoa volta a carregar mais.
 *  - Os extras ficam na cache do React Query: o `queryClient.clear()` do logout apaga-os com tudo o resto (nunca passam de uma conta para outra).
 * O parâmetro `cursor` não está no cliente OpenAPI gerado (ver BUGS.md): usa-se o customFetch com tipos locais.
 */
export const CHAVE_CABECA = ['/api/conversations', 'lista'] as const;   // começa por /api/conversations: as invalidações existentes (bloqueio) apanham-na
export const CHAVE_EXTRAS = ['conversas-extras'] as const;
export const POR_PAGINA = 20;
const POLL_MS = 30_000;

interface RespostaLista { conversas: Conversation[]; proximoCursor: string | null }
export interface Extras {
  itens: Conversation[];
  /** Cursor da página seguinte; null = não há mais. Só vale se `iniciado`; antes disso usa-se o cursor da cabeça. */
  cursor: string | null;
  iniciado: boolean;
  /** Muda sempre que os extras são descartados: um pedido em curso com a versão antiga é ignorado. */
  versao: number;
}
const EXTRAS_VAZIOS: Extras = { itens: [], cursor: null, iniciado: false, versao: 0 };

const pedir = (cursor: string) => customFetch<RespostaLista>(`/api/conversations?cursor=${encodeURIComponent(cursor)}&limite=${POR_PAGINA}`);

/**
 * Reconciliação da cabeça nova com os extras (a regra de continuidade). Exportada para os testes.
 *  - Uma conversa com atividade nova sobe SEMPRE ao topo (atividade = agora). Por isso, se a cabeça nova tem pelo menos uma conversa conhecida e SEM
 *    alterações (mesma última mensagem), todas as que subiram estão na cabeça e nada ficou escondido: os extras mantêm-se.
 *  - As conversas que a cabeça antiga tinha e a nova já não tem foram empurradas para baixo (não desapareceram): passam para o início dos extras,
 *    senão ficavam num buraco entre a cabeça e os extras.
 *  - Se nenhuma conversa da cabeça nova é conhecida e inalterada (mais de uma página com atividade entre dois polls), pode haver conversas que subiram e
 *    ficaram fora da cabeça: os extras são descartados e a pessoa volta a carregar mais.
 */
export function reconciliar(qc: QueryClient, nova: RespostaLista): void {
  const antes = qc.getQueryData<RespostaLista>(CHAVE_CABECA);
  const extras = qc.getQueryData<Extras>(CHAVE_EXTRAS) ?? EXTRAS_VAZIOS;
  if (!extras.iniciado) return;
  const descartar = () => qc.setQueryData<Extras>(CHAVE_EXTRAS, { ...EXTRAS_VAZIOS, versao: extras.versao + 1 });
  if (nova.proximoCursor === null) { descartar(); return; }   // a cabeça já tem a lista toda
  if (!nova.conversas.length) return;
  const copias = new Map<number, Conversation>();
  for (const c of extras.itens) copias.set(c.id, c);
  for (const c of antes?.conversas ?? []) copias.set(c.id, c);
  const semAlteracoes = nova.conversas.some((c) => { const k = copias.get(c.id); return !!k && (k.ultimaMensagem?.id ?? null) === (c.ultimaMensagem?.id ?? null); });
  if (!semAlteracoes) { descartar(); return; }
  const novasIds = new Set(nova.conversas.map((c) => c.id));
  const empurradas = (antes?.conversas ?? []).filter((c) => !novasIds.has(c.id));
  if (!empurradas.length) return;
  const idsEmpurradas = new Set(empurradas.map((c) => c.id));
  qc.setQueryData<Extras>(CHAVE_EXTRAS, { ...extras, itens: [...empurradas, ...extras.itens.filter((c) => !idsEmpurradas.has(c.id))] });
}

/** Tira dos extras as conversas que cumprem `quais` (p. ex. a que acabou de ser bloqueada). */
export function removerDosExtras(qc: QueryClient, quais: (c: Conversation) => boolean): void {
  const e = qc.getQueryData<Extras>(CHAVE_EXTRAS);
  if (!e || !e.itens.some(quais)) return;
  qc.setQueryData<Extras>(CHAVE_EXTRAS, { ...e, itens: e.itens.filter((c) => !quais(c)) });
}

/** Marca como lida (localmente) uma conversa que está nos extras: o servidor já o fez, e os extras não se recarregam sozinhos. */
export function zerarNaoLidasNosExtras(qc: QueryClient, convId: number): void {
  const e = qc.getQueryData<Extras>(CHAVE_EXTRAS);
  if (!e || !e.itens.some((c) => c.id === convId && (c.totalNaoLidas ?? 0) > 0)) return;
  qc.setQueryData<Extras>(CHAVE_EXTRAS, { ...e, itens: e.itens.map((c) => (c.id === convId ? { ...c, totalNaoLidas: 0 } : c)) });
}

/** Descarta todos os extras (p. ex. ao desbloquear: a conversa volta à lista numa posição que não se sabe). */
export function limparExtras(qc: QueryClient): void {
  const e = qc.getQueryData<Extras>(CHAVE_EXTRAS) ?? EXTRAS_VAZIOS;
  if (e.iniciado || e.itens.length) qc.setQueryData<Extras>(CHAVE_EXTRAS, { ...EXTRAS_VAZIOS, versao: e.versao + 1 });
}

interface Opcoes { poll?: boolean; enabled?: boolean }

export function useConversas({ poll = false, enabled = true }: Opcoes = {}) {
  const qc = useQueryClient();
  const cabeca = useQuery<RespostaLista>({
    queryKey: CHAVE_CABECA,
    queryFn: async () => { const r = await pedir(''); reconciliar(qc, r); return r; },
    enabled,
    refetchInterval: poll ? POLL_MS : false,
  });
  // Os extras vivem na cache (partilhados por todos os consumidores); nunca se pedem sozinhos
  const { data: extras = EXTRAS_VAZIOS } = useQuery<Extras>({ queryKey: CHAVE_EXTRAS, queryFn: () => EXTRAS_VAZIOS, enabled: false, initialData: EXTRAS_VAZIOS, staleTime: Infinity, gcTime: Infinity });

  const [aCarregarMais, setACarregarMais] = useState(false);
  const [erroMais, setErroMais] = useState(false);
  const emVoo = useRef(false);

  const dadosCabeca = cabeca.data;
  let conversas: Conversation[] | undefined;
  if (dadosCabeca) {
    const ids = new Set(dadosCabeca.conversas.map((c) => c.id));
    conversas = extras.itens.length ? [...dadosCabeca.conversas, ...extras.itens.filter((c) => !ids.has(c.id))] : dadosCabeca.conversas;
  }
  const proximo = extras.iniciado ? extras.cursor : (dadosCabeca?.proximoCursor ?? null);
  const podeMais = !!dadosCabeca && proximo !== null;

  /** Devolve o id da primeira conversa nova (para o foco), ou null se nada foi acrescentado. */
  const carregarMais = async (): Promise<number | null> => {
    const atual = qc.getQueryData<Extras>(CHAVE_EXTRAS) ?? EXTRAS_VAZIOS;
    const cursor = atual.iniciado ? atual.cursor : (qc.getQueryData<RespostaLista>(CHAVE_CABECA)?.proximoCursor ?? null);
    if (emVoo.current || cursor === null) return null;
    emVoo.current = true; setACarregarMais(true); setErroMais(false);
    try {
      const r = await pedir(cursor);
      const agora = qc.getQueryData<Extras>(CHAVE_EXTRAS) ?? EXTRAS_VAZIOS;
      if (agora.versao !== atual.versao) return null;   // os extras foram descartados entretanto (continuidade, desbloqueio): resposta antiga, ignora
      const ja = new Set([...(qc.getQueryData<RespostaLista>(CHAVE_CABECA)?.conversas ?? []), ...agora.itens].map((c) => c.id));
      const novas = r.conversas.filter((c) => !ja.has(c.id));
      qc.setQueryData<Extras>(CHAVE_EXTRAS, { itens: [...agora.itens, ...novas], cursor: r.proximoCursor, iniciado: true, versao: agora.versao });
      return novas[0]?.id ?? null;
    } catch {
      setErroMais(true);
      return null;
    } finally {
      emVoo.current = false; setACarregarMais(false);
    }
  };

  return {
    conversas,
    isLoading: cabeca.isLoading,
    isError: cabeca.isError && !dadosCabeca,
    podeMais, aCarregarMais, erroMais, carregarMais,
    /** Já se carregou pelo menos uma página extra e chegou-se ao fim (para o aviso «não há mais»). */
    chegouAoFim: extras.iniciado && extras.cursor === null,
  };
}
