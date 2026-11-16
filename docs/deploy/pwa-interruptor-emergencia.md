# Interruptor de emergência da PWA (service worker) — 1 página

Use isto se a app instalada ou o site ficarem presos numa versão antiga, mostrarem a página «Sem ligação» com internet, ou depois de qualquer deploy que parta a navegação.
Tempo: cerca de 30 segundos. Não toca na API, na base de dados nem no painel de admin.

## 1. Pôr o interruptor no lugar do sw.js (VPS de produção)
```bash
cd /var/www/xclusive
sudo cp sw.js sw.js.bak                       # guarda o service worker real
sudo cp /caminho/do/repositorio/docs/deploy/sw-kill.js sw.js   # (ou copiar o conteúdo de sw-kill.js para este ficheiro)
```
Não é preciso `nginx -s reload`: o `/sw.js` é servido com `Cache-Control: no-cache`, por isso o browser vai buscar o novo ficheiro na próxima visita.

## 2. Confirmar que o servidor já serve o interruptor
```bash
curl -s https://xclusive.ao/sw.js | head -3        # deve começar por «/* Xclusive — INTERRUPTOR DE EMERGÊNCIA…»
```

## 3. Confirmar que desinstalou (num browser que já tinha a app)
1. Abre https://xclusive.ao, espera uns segundos (a página pode recarregar sozinha uma vez).
2. Consola do browser (F12):
   ```js
   (await navigator.serviceWorker.getRegistrations()).length   // 0
   await caches.keys()                                          // []
   ```
3. Chrome/Edge: DevTools → Application → Service workers: sem registos; Cache storage: vazio.
4. Se algum dispositivo continuar preso: Definições do site → «Limpar dados» (ou desinstalar e voltar a instalar a app).

## 4. Voltar ao normal
Corrigir o problema, fazer o deploy normal do front (o build gera um sw.js novo) e, se tiver feito a cópia de segurança, repor com `sudo mv sw.js.bak sw.js` **apenas** se quiser o service worker antigo; o deploy normal já o substitui.

## Notas
- O registo no site (`iniciarPwa`) volta a tentar registar `/sw.js` em cada visita; com o interruptor instalado, cada visita regista-o, ele apaga as caches e desregista-se. É inofensivo e não gera ciclos de recarga.
- Para parar de vez o registo, é preciso um novo deploy do front sem `iniciarPwa()` (fora do âmbito de emergência).
- O painel de admin nunca depende do service worker (navegações vão sempre à rede), por isso não precisa deste passo.
