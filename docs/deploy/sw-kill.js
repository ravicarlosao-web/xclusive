/* Xclusive — INTERRUPTOR DE EMERGÊNCIA do service worker.
 * Pôr este ficheiro no lugar do sw.js do site (guia: docs/deploy/pwa-interruptor-emergencia.md). Quando o browser o instalar:
 *   1. apaga TODAS as caches;
 *   2. desregista-se a si próprio (o site volta a funcionar só com a rede, como antes da PWA);
 *   3. recarrega as páginas que estavam abertas e controladas pelo service worker antigo.
 * Não intercepta pedidos (sem fetch handler) e não guarda nada. É seguro correr várias vezes.
 */
self.addEventListener("install", () => { self.skipWaiting(); });

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try { const nomes = await caches.keys(); await Promise.all(nomes.map((n) => caches.delete(n))); } catch (_) { /* segue */ }
    // Só recarrega as páginas controladas pelo SW antigo (as que ficaram presas). Se não havia SW antes, não há nada para recarregar (evita ciclos).
    let paginas = [];
    try { paginas = await self.clients.matchAll({ type: "window" }); } catch (_) { /* segue */ }
    try { await self.registration.unregister(); } catch (_) { /* segue */ }
    for (const p of paginas) { try { p.navigate(p.url); } catch (_) { /* segue */ } }
  })());
});
