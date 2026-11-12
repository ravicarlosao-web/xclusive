import { useEffect, useRef, useState } from 'react';
import { getMessages, type PaginatedMessages } from '@workspace/api-client-react';

/**
 * Poll inteligente da conversa aberta: pede GET /api/conversations/:id/messages?depois=<último id> e só traz o que é novo.
 *  - ritmo: 5 s; depois de 3 pedidos vazios seguidos passa a 10 s, depois a 20 s e fica em 30 s (teto). Jitter de ±15 %.
 *    Janela visível sem foco: no mínimo 10 s. Qualquer novidade, envio, interação, foco ou regresso ao separador volta aos 5 s.
 *  - pausa com o separador escondido e sem rede; retoma de imediato ao voltar (visibilitychange, focus, online).
 *  - um só pedido em voo; aborta ao trocar de conversa ou desmontar; o Retry-After do 429 é respeitado.
 *  - falha de rede: recuo 5, 10, 20, 40, 60 s; ao 2.º falhanço seguido mostra o aviso «sem ligação».
 *  - se a resposta diz que há mais (hasMore) volta a pedir logo a seguir, no máximo 4 vezes seguidas (as mensagens vêm por ordem crescente, por isso
 *    nunca fica um buraco: o pedido seguinte continua da última recebida).
 * Usa o cliente OpenAPI gerado (getMessages com `depois`), que passa pelo mesmo customFetch (token, renovação e erros iguais).
 */
export const NIVEIS_MS = [5_000, 10_000, 20_000, 30_000];
export const VAZIOS_POR_NIVEL = 3;
export const SEM_FOCO_MS = 10_000;
const JITTER = 0.15;
const MAX_SEGUIDOS = 4;
const FALHAS_PARA_AVISO = 2;
const ATRASO_MAX_FALHA_MS = 60_000;
const RETRY_AFTER_OMISSAO_MS = 30_000;

/** A resposta de `depois` é a das mensagens (sem `podeEnviar`/`restricao` quando não há novidades). */
export type RespostaDepois = PaginatedMessages;

interface Opcoes {
  convId: number;
  /** false: não corre (a janela principal ainda a carregar, conversa indisponível…). */
  ativo: boolean;
  /** Último id conhecido, lido no momento do pedido; null enquanto não há mensagens carregadas. */
  ultimoId: () => number | null;
  aoReceber: (r: RespostaDepois) => void;
  /** 403/404: a conversa deixou de estar disponível (o painel mostra o seu estado). */
  aoIndisponivel: () => void;
}

export function useNovasMensagens(opcoes: Opcoes): { semLigacao: boolean; tentarAgora: () => void; reiniciar: () => void } {
  const { convId, ativo } = opcoes;
  const o = useRef(opcoes);
  o.current = opcoes;
  const [semLigacao, setSemLigacao] = useState(false);
  const acoes = useRef({ tentarAgora: () => {}, reiniciar: () => {} });

  useEffect(() => {
    if (!ativo || convId <= 0) return;
    let vivo = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let aborter: AbortController | null = null;
    let emVoo = false;
    let vazios = 0;
    let falhas = 0;
    let seguidos = 0;
    let proximaPermitida = 0;
    let ultimaInteracao = 0;

    const visivel = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
    const comRede = () => typeof navigator === 'undefined' || navigator.onLine !== false;
    const semFoco = () => typeof document !== 'undefined' && typeof document.hasFocus === 'function' && !document.hasFocus();
    const parar = () => { if (timer) { clearTimeout(timer); timer = null; } };

    const atrasoMs = (): number => {
      let base = falhas > 0
        ? Math.min(ATRASO_MAX_FALHA_MS, NIVEIS_MS[0] * 2 ** (falhas - 1))
        : NIVEIS_MS[Math.min(Math.floor(vazios / VAZIOS_POR_NIVEL), NIVEIS_MS.length - 1)];
      if (semFoco()) base = Math.max(base, SEM_FOCO_MS);
      const comJitter = base * (1 + (Math.random() * 2 - 1) * JITTER);
      return Math.max(comJitter, proximaPermitida - Date.now());
    };
    const agendar = (ms?: number) => {
      parar();
      if (!vivo || !visivel() || !comRede()) return;   // em pausa: retoma por evento
      timer = setTimeout(() => { timer = null; void poll(); }, ms ?? atrasoMs());
    };

    const poll = async (): Promise<void> => {
      if (!vivo || emVoo || !visivel() || !comRede()) return;
      const espera = proximaPermitida - Date.now();
      if (espera > 0) { agendar(espera); return; }
      const ultimo = o.current.ultimoId();
      if (ultimo === null) { agendar(); return; }
      emVoo = true;
      aborter = new AbortController();
      let imediato = false;
      try {
        const r = await getMessages(convId, { depois: ultimo, limite: 50 }, { signal: aborter.signal });
        if (!vivo) return;
        falhas = 0;
        setSemLigacao(false);
        if (r.messages.length > 0) {
          vazios = 0;
          o.current.aoReceber(r);
          if (r.hasMore && seguidos < MAX_SEGUIDOS) { seguidos++; imediato = true; } else seguidos = 0;
        } else {
          vazios++;
          seguidos = 0;
        }
      } catch (e) {
        if (!vivo || (e as { name?: string })?.name === 'AbortError') return;
        const err = e as { status?: number; headers?: Headers };
        if (err.status === 403 || err.status === 404) { vivo = false; o.current.aoIndisponivel(); return; }
        if (err.status === 429) {
          const ra = Number(err.headers?.get?.('retry-after'));
          proximaPermitida = Date.now() + (Number.isFinite(ra) && ra > 0 ? ra * 1000 : RETRY_AFTER_OMISSAO_MS);
        } else {
          falhas++;
          if (falhas >= FALHAS_PARA_AVISO) setSemLigacao(true);
        }
      } finally {
        emVoo = false;
        aborter = null;
      }
      if (!vivo) return;
      if (imediato) void poll(); else agendar();
    };

    // Regresso ao separador, foco ou rede de volta: poll imediato e ritmo base.
    const retomar = () => { if (!vivo) return; parar(); vazios = 0; seguidos = 0; void poll(); };
    const reiniciar = () => { if (!vivo) return; vazios = 0; seguidos = 0; if (!emVoo) agendar(NIVEIS_MS[0]); };
    const aoVisibilidade = () => { if (visivel()) retomar(); else parar(); };
    const aoInteragir = () => {
      const t = Date.now();
      if (t - ultimaInteracao < 2000) return;
      ultimaInteracao = t;
      if (vazios > 0) { vazios = 0; if (!emVoo) agendar(); }
    };

    acoes.current = { tentarAgora: () => { falhas = 0; proximaPermitida = 0; retomar(); }, reiniciar };
    document.addEventListener('visibilitychange', aoVisibilidade);
    window.addEventListener('focus', retomar);
    window.addEventListener('online', retomar);
    window.addEventListener('offline', parar);
    for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, aoInteragir, { passive: true });
    agendar(NIVEIS_MS[0]);

    return () => {
      vivo = false;
      parar();
      aborter?.abort();
      document.removeEventListener('visibilitychange', aoVisibilidade);
      window.removeEventListener('focus', retomar);
      window.removeEventListener('online', retomar);
      window.removeEventListener('offline', parar);
      for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.removeEventListener(ev, aoInteragir);
      acoes.current = { tentarAgora: () => {}, reiniciar: () => {} };
      setSemLigacao(false);
    };
  }, [convId, ativo]);

  return { semLigacao, tentarAgora: () => acoes.current.tentarAgora(), reiniciar: () => acoes.current.reiniciar() };
}
