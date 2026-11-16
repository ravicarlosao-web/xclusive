import { escreverLocal, lerLocal } from '@/lib/armazenamento';
/**
 * App instalável (PWA): registo do service worker, aviso de nova versão e instalação.
 *
 *  - Só em produção (import.meta.env.PROD) e com suporte do browser. Nunca em desenvolvimento. As suites de teste automáticas (Playwright, navigator.webdriver)
 *    também ficam de fora, salvo se a página definir window.__XCLUSIVE_PWA__ = true antes de carregar (é assim que a suite `pwa` o ativa).
 *  - Falhas são silenciosas (try/catch): a app funciona exatamente igual sem service worker.
 *  - Um SW novo fica À ESPERA; só carregar em «Atualizar» o faz assumir (mensagem SKIP_WAITING) e só então a página recarrega. Nunca recarrega sozinha.
 *  - localStorage só dentro de try/catch (pode não existir).
 */
type EventoInstalar = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
export interface EstadoPwa { ativo: boolean; novaVersao: boolean; podeInstalar: boolean; instalada: boolean; ios: boolean }

const HORA_MS = 60 * 60 * 1000;
export const CHAVE_AVISO_INSTALAR = 'xclusive_pwa_aviso_instalar';

export function pwaAtivo(): boolean {
  try {
    if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
    if (navigator.webdriver && (window as unknown as { __XCLUSIVE_PWA__?: boolean }).__XCLUSIVE_PWA__ !== true) return false;
    return true;
  } catch { return false; }
}

function emStandalone(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  } catch { return false; }
}
function eIos(): boolean {
  try {
    return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  } catch { return false; }
}

export function lerFlag(chave: string): boolean { try { return lerLocal(chave) === '1'; } catch { return false; } }
export function gravarFlag(chave: string): void { try { escreverLocal(chave, '1'); } catch { /* sem armazenamento: vale só nesta visita */ } }

let estado: EstadoPwa = { ativo: false, novaVersao: false, podeInstalar: false, instalada: false, ios: false };
const ouvintes = new Set<() => void>();
let registo: ServiceWorkerRegistration | null = null;
let diferido: EventoInstalar | null = null;
let ultimaVerificacao = 0;

function definir(parcial: Partial<EstadoPwa>): void { estado = { ...estado, ...parcial }; ouvintes.forEach((f) => f()); }
export const subscreverPwa = (f: () => void): (() => void) => { ouvintes.add(f); return () => { ouvintes.delete(f); }; };
export const lerEstadoPwa = (): EstadoPwa => estado;

function observar(reg: ServiceWorkerRegistration): void {
  registo = reg;
  ultimaVerificacao = Date.now();
  if (reg.waiting && navigator.serviceWorker.controller) definir({ novaVersao: true });
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) definir({ novaVersao: true }); });
  });
  // Ao regressar ao separador, procura versão nova (no máximo uma vez por hora).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || Date.now() - ultimaVerificacao < HORA_MS) return;
    ultimaVerificacao = Date.now();
    try { reg.update().catch(() => {}); } catch { /* silencioso */ }
  });
}

export function iniciarPwa(): void {
  try {
    if (!pwaAtivo()) return;
    definir({ ativo: true, instalada: emStandalone(), ios: eIos() });
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); diferido = e as EventoInstalar; definir({ podeInstalar: true }); });
    window.addEventListener('appinstalled', () => { diferido = null; definir({ podeInstalar: false, instalada: true }); });
    try { window.matchMedia('(display-mode: standalone)').addEventListener('change', () => definir({ instalada: emStandalone() })); } catch { /* silencioso */ }
    const registar = () => {
      try { navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(observar).catch(() => {}); } catch { /* silencioso */ }
    };
    if (document.readyState === 'complete') registar(); else window.addEventListener('load', registar, { once: true });
  } catch { /* silencioso */ }
}

/** Botão «Atualizar»: o SW novo assume e SÓ ENTÃO a página recarrega (uma vez). */
export function atualizarAgora(): void {
  try {
    const espera = registo?.waiting;
    if (!espera) return;
    let recarregou = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!recarregou) { recarregou = true; window.location.reload(); } });
    espera.postMessage({ type: 'SKIP_WAITING' });
  } catch { /* silencioso */ }
}

/** Abre o prompt nativo de instalação (Android/desktop). */
export async function instalarApp(): Promise<'aceite' | 'recusado' | 'indisponivel'> {
  const ev = diferido;
  if (!ev) return 'indisponivel';
  try {
    await ev.prompt();
    const r = await ev.userChoice;
    diferido = null;
    definir({ podeInstalar: false });
    return r.outcome === 'accepted' ? 'aceite' : 'recusado';
  } catch { return 'indisponivel'; }
}
