/**
 * Espectador WebRTC para o OvenMediaEngine (sinalização por WebSocket à mão).
 *
 * Protocolo (igual ao do OvenPlayer, referência MIT):
 *   → request_offer
 *   ← offer { id, peer_id, sdp, candidates, ice_servers }
 *   → answer { id, peer_id, sdp }  /  → candidate { id, peer_id, candidates }
 *   ← candidate, ← ping (→ pong), ← stop
 *
 * Usa o <video> que lhe derem (srcObject) e NUNCA expõe nem regista o URL: o URL
 * leva o token de espectador. As falhas são reportadas por códigos fixos
 * (WebrtcFailReason), nunca por mensagens de erro.
 */

export type WebrtcFailReason =
  | 'unsupported'
  | 'ws_error'
  | 'ws_closed'
  | 'signalling_error'
  | 'no_offer'
  | 'sdp_error'
  | 'ice_timeout'
  | 'ice_failed'
  | 'ice_disconnected'
  | 'no_first_frame'
  | 'frames_stalled'
  | 'stopped_by_server';

export type WebrtcViewerState =
  | 'ws_open'
  | 'offer'
  | 'ice_checking'
  | 'ice_connected'
  | 'track'
  | 'first_frame'
  /** Caminho do par ICE escolhido (só o tipo — nunca IPs ou portas). */
  | 'path_udp'
  | 'path_tcp_relay'
  | 'path_other';

export interface WebrtcViewerStats {
  fps: number;
  kbps: number;
  packetsLost: number;
}

export interface WebrtcViewerCallbacks {
  onState?: (state: WebrtcViewerState) => void;
  /** Chamado no máximo uma vez; a sessão já está fechada quando isto corre. */
  onFailed: (reason: WebrtcFailReason) => void;
  /** De 5 em 5 s depois do primeiro frame. */
  onStats?: (stats: WebrtcViewerStats) => void;
  /** Uma vez por offer: só contagens, booleanos e NOMES de chaves (nunca valores). */
  onIceInfo?: (info: WebrtcIceInfo) => void;
}

export interface WebrtcIceInfo {
  /** Como veio o campo ice_servers: ausente, array ou outro formato. */
  shape: 'absent' | 'array' | 'non_array';
  /** Entradas recebidas e entradas utilizáveis (com `urls`). */
  count: number;
  usable: number;
  /** Algum URL é turn: ou turns:. */
  turn: boolean;
  relayRequested: boolean;
  relayApplied: boolean;
  /** Nomes das chaves de topo do offer e dos campos das entradas de ice_servers. */
  topKeys: string[];
  iceKeys: string[];
}

export interface WebrtcViewerTimings {
  /** Sem `offer` do servidor (inclui abrir a WebSocket). */
  offerTimeoutMs: number;
  /** Do `offer` até o ICE ligar. */
  iceTimeoutMs: number;
  /** Do ICE ligado até ao primeiro frame. */
  firstFrameTimeoutMs: number;
  /** Sem frames novos (só conta com a aba visível, depois do primeiro frame). */
  frameStallMs: number;
  /** Tolerância quando a aba volta a ficar visível. */
  hiddenGraceMs: number;
  /** ICE `disconnected` durante mais do que isto = falha. */
  iceDisconnectedMs: number;
}

export const DEFAULT_WEBRTC_TIMINGS: WebrtcViewerTimings = {
  offerTimeoutMs: 6000,
  iceTimeoutMs: 6000,
  firstFrameTimeoutMs: 6000,
  frameStallMs: 6000,
  hiddenGraceMs: 3000,
  iceDisconnectedMs: 3000,
};

export interface WebrtcViewerOptions {
  /** wss://…/live/<streamKey>?token=<token> — nunca é registado. */
  url: string;
  video: HTMLVideoElement;
  callbacks: WebrtcViewerCallbacks;
  timings?: Partial<WebrtcViewerTimings>;
  iceTransportPolicy?: RTCIceTransportPolicy;
}

export interface WebrtcViewerSession {
  /** Idempotente: fecha WebSocket, ligação WebRTC e timers e limpa o srcObject. */
  close: () => void;
}

export function isWebrtcViewerSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof RTCPeerConnection !== 'undefined' &&
    typeof WebSocket !== 'undefined'
  );
}

/** Só nomes simples de chaves: um nome estranho nunca é registado (podia esconder um valor). */
function safeKeyNames(keys: string[]): string[] {
  const out = new Set<string>();
  for (const k of keys) out.add(/^[A-Za-z0-9_]{1,32}$/.test(k) ? k : '?');
  return [...out].sort().slice(0, 20);
}

interface BuiltIceServers {
  servers: RTCIceServer[];
  shape: WebrtcIceInfo['shape'];
  count: number;
  usable: number;
  turn: boolean;
  iceKeys: string[];
}

/** Adiciona ao TURN do OME uma cópia com o IP substituído pelo host da WebSocket (como o OvenPlayer). */
function buildIceServers(raw: any, wsHost: string): BuiltIceServers {
  const out: RTCIceServer[] = [];
  const keys: string[] = [];
  if (raw === undefined || raw === null) return { servers: out, shape: 'absent', count: 0, usable: 0, turn: false, iceKeys: [] };
  if (!Array.isArray(raw)) return { servers: out, shape: 'non_array', count: 0, usable: 0, turn: false, iceKeys: [] };
  let turn = false;
  for (const s of raw) {
    if (s && typeof s === 'object') keys.push(...Object.keys(s));
    if (!s || !s.urls) continue;
    const urls: string[] = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u: unknown) => typeof u === 'string');
    if (urls.length === 0) continue;
    if (wsHost && !urls.some((u) => u.includes(wsHost))) {
      const ip = urls[0].match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/)?.[0];
      if (ip) urls.push(urls[0].replace(ip, wsHost));
    }
    if (urls.some((u) => /^turns?:/i.test(u))) turn = true;
    const server: RTCIceServer = { urls };
    const username = s.username ?? s.user_name;
    if (username) server.username = username;
    if (s.credential) server.credential = s.credential;
    out.push(server);
  }
  return { servers: out, shape: 'array', count: raw.length, usable: out.length, turn, iceKeys: safeKeyNames(keys) };
}

export function connectOvenWebrtcViewer(options: WebrtcViewerOptions): WebrtcViewerSession {
  const { video, callbacks } = options;
  const t: WebrtcViewerTimings = { ...DEFAULT_WEBRTC_TIMINGS, ...options.timings };

  let closed = false;
  let ws: WebSocket | null = null;
  let pc: RTCPeerConnection | null = null;
  let ownedStream: MediaStream | null = null;
  let peerInfo: { id: unknown; peerId: unknown } | null = null;
  let firstFrameSeen = false;

  let offerTimer: ReturnType<typeof setTimeout> | null = null;
  let iceTimer: ReturnType<typeof setTimeout> | null = null;
  let firstFrameTimer: ReturnType<typeof setTimeout> | null = null;
  let disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let monitorTimer: ReturnType<typeof setInterval> | null = null;

  // Estado da deteção de falta de frames
  let lastFrames = -1;
  let lastBytes = -1;
  let lastProgressAt = Date.now();
  let lastTickAt = Date.now();
  let graceUntil = 0;
  let tickCount = 0;

  /** Lê o par de candidatos escolhido e reporta só o tipo de caminho (udp | tcp_relay | other). */
  const reportPath = async (conn: RTCPeerConnection) => {
    try {
      const report = await conn.getStats();
      const byId = new Map<string, any>();
      report.forEach((st: any) => byId.set(st.id, st));
      let pair: any = null;
      report.forEach((st: any) => {
        if (st.type === 'transport' && st.selectedCandidatePairId) pair = byId.get(st.selectedCandidatePairId);
      });
      if (!pair) {
        report.forEach((st: any) => {
          if (st.type === 'candidate-pair' && st.nominated && st.state === 'succeeded') pair = st;
        });
      }
      const local = pair ? byId.get(pair.localCandidateId) : null;
      if (closed || !local) return;
      const viaTcp = local.protocol === 'tcp' || local.relayProtocol === 'tcp' || local.relayProtocol === 'tls';
      if (local.candidateType === 'relay' && viaTcp) callbacks.onState?.('path_tcp_relay');
      else if (local.protocol === 'udp') callbacks.onState?.('path_udp');
      else callbacks.onState?.('path_other');
    } catch {
      /* sem estatísticas: não reporta o caminho */
    }
  };

  const clearTimers = () => {
    for (const h of [offerTimer, iceTimer, firstFrameTimer, disconnectTimer]) {
      if (h) clearTimeout(h);
    }
    offerTimer = iceTimer = firstFrameTimer = disconnectTimer = null;
    if (monitorTimer) clearInterval(monitorTimer);
    monitorTimer = null;
  };

  const onVisibility = () => {
    if (!document.hidden) {
      // A aba voltou: tolerância antes de voltar a avaliar frames.
      graceUntil = Date.now() + t.hiddenGraceMs;
      lastProgressAt = graceUntil;
    }
  };
  const onPlaying = () => {
    if (firstFrameSeen || closed) return;
    firstFrameSeen = true;
    if (firstFrameTimer) clearTimeout(firstFrameTimer);
    firstFrameTimer = null;
    callbacks.onState?.('first_frame');
    startMonitor();
  };

  const close = () => {
    if (closed) return;
    closed = true;
    clearTimers();
    document.removeEventListener('visibilitychange', onVisibility);
    video.removeEventListener('playing', onPlaying);
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try {
        if (ws.readyState === WebSocket.OPEN && peerInfo) {
          ws.send(JSON.stringify({ command: 'stop', id: peerInfo.id }));
        }
        ws.close();
      } catch {
        /* nada a fazer */
      }
      ws = null;
    }
    if (pc) {
      pc.ontrack = pc.onicecandidate = pc.oniceconnectionstatechange = null;
      try {
        pc.close();
      } catch {
        /* nada a fazer */
      }
      pc = null;
    }
    if (ownedStream && video.srcObject === ownedStream) video.srcObject = null;
    ownedStream = null;
  };

  const fail = (reason: WebrtcFailReason) => {
    if (closed) return;
    close();
    callbacks.onFailed(reason);
  };

  const send = (msg: Record<string, unknown>) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  // ── Deteção de falta de frames (só depois do primeiro frame) ────────────────
  const startMonitor = () => {
    lastProgressAt = Date.now();
    lastTickAt = Date.now();
    monitorTimer = setInterval(async () => {
      if (closed || !pc) return;
      const now = Date.now();
      const elapsed = now - lastTickAt;
      lastTickAt = now;

      // Suspensa com a aba escondida, e em tolerância ao voltar: o relógio não corre.
      if (document.hidden || now < graceUntil) {
        lastProgressAt = Math.max(now, graceUntil);
        return;
      }
      // Timers estrangulados/suspensos (ex.: aba em segundo plano): não conta como falta de frames.
      if (elapsed > 2500) {
        lastProgressAt = now;
        return;
      }

      let frames = -1;
      let bytes = -1;
      let fps = 0;
      let lost = 0;
      try {
        const report = await pc.getStats();
        report.forEach((s: any) => {
          if (s.type === 'inbound-rtp' && s.kind === 'video') {
            frames = s.framesDecoded ?? frames;
            bytes = s.bytesReceived ?? bytes;
            fps = s.framesPerSecond ?? 0;
            lost = s.packetsLost ?? 0;
          }
        });
      } catch {
        /* sem estatísticas neste ciclo */
      }
      if (closed) return;

      const progressed =
        (frames >= 0 && frames > lastFrames) ||
        (frames < 0 && video.currentTime > 0 && !video.paused && !video.ended);
      if (progressed) lastProgressAt = Date.now();
      const bytesDelta = bytes >= 0 && lastBytes >= 0 ? bytes - lastBytes : 0;
      if (frames >= 0) lastFrames = frames;
      if (bytes >= 0) lastBytes = bytes;

      tickCount += 1;
      if (tickCount % 5 === 0 && callbacks.onStats) {
        callbacks.onStats({ fps: Math.round(fps), kbps: Math.round((bytesDelta * 8) / 1000 / 1), packetsLost: lost });
      }

      if (Date.now() - lastProgressAt >= t.frameStallMs) fail('frames_stalled');
    }, 1000);
  };

  // ── Oferta do servidor → resposta ───────────────────────────────────────────
  const handleOffer = async (msg: any) => {
    if (offerTimer) clearTimeout(offerTimer);
    offerTimer = null;
    callbacks.onState?.('offer');
    iceTimer = setTimeout(() => fail('ice_timeout'), t.iceTimeoutMs);

    let wsHost = '';
    try {
      wsHost = new URL(options.url).hostname;
    } catch {
      /* sem host */
    }

    const ice = buildIceServers(msg.ice_servers ?? msg.iceServers, wsHost);
    // 'relay' sem nenhum servidor TURN não recolhe candidatos e o ICE nunca arranca: nesse caso fica 'all'.
    const relayRequested = options.iceTransportPolicy === 'relay';
    const relayApplied = relayRequested && ice.turn;
    try {
      callbacks.onIceInfo?.({
        shape: ice.shape,
        count: ice.count,
        usable: ice.usable,
        turn: ice.turn,
        relayRequested,
        relayApplied,
        topKeys: msg && typeof msg === 'object' ? safeKeyNames(Object.keys(msg)) : [],
        iceKeys: ice.iceKeys,
      });
    } catch {
      /* o registo nunca interrompe a ligação */
    }

    try {
      pc = new RTCPeerConnection({
        iceServers: ice.servers,
        iceTransportPolicy: relayRequested ? (relayApplied ? 'relay' : 'all') : (options.iceTransportPolicy ?? 'all'),
      });
    } catch {
      fail('unsupported');
      return;
    }
    peerInfo = { id: msg.id, peerId: msg.peer_id };
    const conn = pc;

    conn.onicecandidate = (e) => {
      if (e.candidate) {
        send({ id: msg.id, peer_id: msg.peer_id, command: 'candidate', candidates: [e.candidate] });
      }
    };

    conn.oniceconnectionstatechange = () => {
      if (closed || pc !== conn) return;
      const state = conn.iceConnectionState;
      if (state === 'checking') {
        callbacks.onState?.('ice_checking');
      } else if (state === 'connected' || state === 'completed') {
        if (iceTimer) clearTimeout(iceTimer);
        iceTimer = null;
        if (disconnectTimer) clearTimeout(disconnectTimer);
        disconnectTimer = null;
        callbacks.onState?.('ice_connected');
        void reportPath(conn);
        if (!firstFrameSeen && !firstFrameTimer) {
          firstFrameTimer = setTimeout(() => fail('no_first_frame'), t.firstFrameTimeoutMs);
        }
      } else if (state === 'disconnected') {
        if (!disconnectTimer) disconnectTimer = setTimeout(() => fail('ice_disconnected'), t.iceDisconnectedMs);
      } else if (state === 'failed' || state === 'closed') {
        fail('ice_failed');
      }
    };

    conn.ontrack = (e) => {
      if (closed || ownedStream) return;
      ownedStream = e.streams[0] ?? new MediaStream([e.track]);
      video.srcObject = ownedStream;
      callbacks.onState?.('track');
      const p = video.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          // Autoplay com som pode ser recusado: tenta mudo (como o caminho HLS).
          video.muted = true;
          video.play().catch(() => undefined);
        });
      }
    };

    try {
      await conn.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      if (closed) return;
      const answer = await conn.createAnswer();
      if (closed) return;
      await conn.setLocalDescription(answer);
      if (closed) return;
      send({ id: msg.id, peer_id: msg.peer_id, command: 'answer', sdp: answer });
      if (Array.isArray(msg.candidates)) {
        for (const c of msg.candidates) {
          if (c && c.candidate) await conn.addIceCandidate(new RTCIceCandidate(c));
        }
      }
    } catch {
      fail('sdp_error');
    }
  };

  // ── Arranque ────────────────────────────────────────────────────────────────
  if (!isWebrtcViewerSupported()) {
    queueMicrotask(() => fail('unsupported'));
    return { close };
  }

  document.addEventListener('visibilitychange', onVisibility);
  video.addEventListener('playing', onPlaying);
  offerTimer = setTimeout(() => fail('no_offer'), t.offerTimeoutMs);

  try {
    ws = new WebSocket(options.url);
  } catch {
    queueMicrotask(() => fail('ws_error'));
    return { close };
  }

  ws.onopen = () => {
    if (closed) return;
    callbacks.onState?.('ws_open');
    send({ command: 'request_offer' });
  };

  ws.onmessage = (ev) => {
    if (closed) return;
    let msg: any;
    try {
      msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    if (msg.error) return fail('signalling_error');
    switch (msg.command) {
      case 'ping':
        send({ command: 'pong' });
        break;
      case 'offer':
        if (!pc) void handleOffer(msg);
        break;
      case 'candidate':
        if (pc && Array.isArray(msg.candidates)) {
          for (const c of msg.candidates) {
            if (c && c.candidate) pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => undefined);
          }
        }
        break;
      case 'stop':
        fail('stopped_by_server');
        break;
      default:
        break;
    }
  };

  ws.onerror = () => fail('ws_error');
  ws.onclose = () => fail('ws_closed');

  return { close };
}
