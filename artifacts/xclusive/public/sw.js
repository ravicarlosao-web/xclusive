/* Xclusive — service worker (escrito à mão, sem dependências).
 * Versão de build: __BUILD_ID__ (injetada no build; cada deploy gera um sw.js diferente → o browser instala o novo e a cache muda de nome).
 *
 * O QUE FAZ — e só isto:
 *   - instalação: pré-guarda /offline.html (página autónoma: CSS e ícone inline). SEM skipWaiting automático: o novo SW espera até o utilizador carregar em «Atualizar» (mensagem SKIP_WAITING).
 *   - ativação: apaga todas as caches com nome antigo e assume a página.
 *   - navegações (request.mode === "navigate"): SEMPRE à rede, nunca ao index.html da SPA (o painel de admin partilha a origem); só se a rede falhar responde /offline.html guardado.
 *   - ficheiros estáticos com hash em /assets/*: cache-first, só respostas 200 do próprio domínio que não sejam HTML (o Nginx devolve index.html com 200 para ficheiros em falta).
 *   - tudo o resto (API, imagens e vídeos de conteúdo ou do CDN, blob:, POST, outros domínios, pedidos com credenciais ou Range, respostas ≠ 200 ou no-store): NÃO chama respondWith → passa direto à rede.
 * Nada privado, pago ou autenticado entra na cache.
 */
const BUILD_ID = "__BUILD_ID__";
const CACHE = "xclusive-" + BUILD_ID;
const OFFLINE = "/offline.html";
const ASSET_COM_HASH = /^\/assets\/[^/]+-[A-Za-z0-9_-]{6,}\.[A-Za-z0-9]+$/;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll([new Request(OFFLINE, { cache: "reload" })])));
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

function guardavel(res) {
  const tipo = res.headers.get("content-type") || "";
  const cc = res.headers.get("cache-control") || "";
  return res.status === 200 && res.type === "basic" && !/text\/html/i.test(tipo) && !/no-store/i.test(cc) && !res.headers.has("set-cookie");
}

async function navegar(request) {
  try {
    return await fetch(request);
  } catch (_) {
    const offline = await (await caches.open(CACHE)).match(OFFLINE);
    return offline || Response.error();
  }
}

async function ficheiroEstatico(request) {
  const cache = await caches.open(CACHE);
  const guardado = await cache.match(request);
  if (guardado) return guardado;
  const res = await fetch(request);
  if (guardavel(res)) { try { await cache.put(request, res.clone()); } catch (_) { /* cota cheia: segue sem guardar */ } }
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate") { event.respondWith(navegar(req)); return; }
  if (req.credentials === "include" || req.headers.has("authorization") || req.headers.has("range")) return;
  if (url.search === "" && url.pathname === OFFLINE) {
    event.respondWith(caches.open(CACHE).then((c) => c.match(OFFLINE)).then((r) => r || fetch(req)));
    return;
  }
  if (ASSET_COM_HASH.test(url.pathname)) { event.respondWith(ficheiroEstatico(req)); return; }
});
