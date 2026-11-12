import { useCallback, useEffect, useRef, useState } from 'react';
import { getGoogleConfig, createGoogleNonce } from '@workspace/api-client-react';

/**
 * Google Identity Services (só o botão, em popup; SEM One Tap). O script da Google é injetado dinamicamente SÓ quando um componente que o pede está
 * montado (login, registo, Definições) e SÓ se GET /auth/google/config devolver um clientId; sem clientId nada é carregado nem aparece.
 *
 * Fluxo: config → nonce (cookie httpOnly de uso único no servidor) → initialize({ client_id, nonce, ux_mode: 'popup', callback }) → renderButton.
 * O nonce gasta-se em cada tentativa e expira em 5 minutos: depois de cada callback, e de 4 em 4 minutos, pede-se um novo e volta a inicializar-se.
 */
export const GSI_SRC = 'https://accounts.google.com/gsi/client';
const RENOVAR_NONCE_MS = 4 * 60 * 1000;

interface Gsi { accounts: { id: {
  initialize: (cfg: { client_id: string; callback: (r: { credential?: string }) => void; nonce?: string; ux_mode?: 'popup' | 'redirect'; auto_select?: boolean; cancel_on_tap_outside?: boolean }) => void;
  renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
} } }
declare global { interface Window { google?: Gsi } }

export type EstadoGoogle = 'a-ver' | 'desligado' | 'a-carregar' | 'pronto' | 'erro-script' | 'erro-rede';

let scriptPromessa: Promise<void> | null = null;
function carregarScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptPromessa) return scriptPromessa;
  scriptPromessa = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GSI_SRC; s.async = true; s.defer = true;
    s.onload = () => (window.google?.accounts?.id ? resolve() : reject(new Error('gsi')));
    s.onerror = () => { s.remove(); reject(new Error('gsi')); };
    document.head.appendChild(s);
  }).catch((e) => { scriptPromessa = null; throw e; });
  return scriptPromessa;
}

/**
 * Prepara o botão da Google dentro de `alvo`. `aoCredencial` recebe o ID token (o chamador envia-o à API). Devolve o estado e `renovar` (novo nonce).
 */
export function useGoogleIdentity(alvo: React.RefObject<HTMLElement | null>, aoCredencial: (credential: string) => void, ativo = true) {
  const [estado, setEstado] = useState<EstadoGoogle>('a-ver');
  const cb = useRef(aoCredencial);
  cb.current = aoCredencial;
  const clientId = useRef<string | null>(null);
  const vivo = useRef(true);

  const iniciar = useCallback(async () => {
    const id = clientId.current; const el = alvo.current;
    if (!id || !el || !window.google?.accounts?.id) return;
    const { nonce } = await createGoogleNonce();
    if (!vivo.current || !alvo.current) return;
    window.google.accounts.id.initialize({
      client_id: id, nonce, ux_mode: 'popup', auto_select: false, cancel_on_tap_outside: true,
      callback: (r) => {
        const c = r?.credential;
        // o nonce gasta-se em cada tentativa (o servidor apaga o cookie): prepara já o seguinte
        void iniciar().catch(() => setEstado('erro-rede'));
        if (c) cb.current(c);
      },
    });
    el.replaceChildren();
    window.google.accounts.id.renderButton(el, { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', shape: 'rectangular', logo_alignment: 'left', width: Math.min(400, Math.max(200, el.clientWidth || 320)), locale: 'pt-PT' });
  }, [alvo]);

  useEffect(() => {
    vivo.current = true;
    if (!ativo) { setEstado('a-ver'); return; }
    let temporizador: ReturnType<typeof setInterval> | null = null;
    (async () => {
      try {
        const cfg = await getGoogleConfig();
        if (!vivo.current) return;
        if (!cfg.clientId) { setEstado('desligado'); return; }
        clientId.current = cfg.clientId;
        setEstado('a-carregar');
        try { await carregarScript(); } catch { if (vivo.current) setEstado('erro-script'); return; }
        if (!vivo.current) return;
        await iniciar();
        if (vivo.current) setEstado('pronto');
        temporizador = setInterval(() => { void iniciar().catch(() => {}); }, RENOVAR_NONCE_MS);
      } catch {
        // sem configuração (rede/erro): o botão simplesmente não aparece
        if (vivo.current) setEstado('desligado');
      }
    })();
    return () => { vivo.current = false; if (temporizador) clearInterval(temporizador); };
  }, [iniciar, ativo]);

  return { estado, renovar: iniciar };
}
