import path from 'path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const rawPort = process.env.PORT_WEB || process.env.VITE_PORT || '19285';
const port = Number(rawPort);
const basePath = process.env.BASE_PATH || '/';

/**
 * Injeta o identificador de build no sw.js copiado para dist/public: PWA_BUILD_ID (se definido) ou um hash dos nomes dos ficheiros do build
 * (que já levam o hash do conteúdo). Cada deploy com conteúdo diferente gera um sw.js diferente → o browser instala o novo e a cache muda de nome.
 */
function swBuildId(): import('vite').Plugin {
  let outDir = '';
  return {
    name: 'xclusive-sw-build-id',
    apply: 'build',
    configResolved(c) { outDir = path.resolve(c.root, c.build.outDir); },
    closeBundle() {
      const sw = path.join(outDir, 'sw.js');
      if (!fs.existsSync(sw)) return;
      const lista = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? lista(path.join(d, e.name)).map((f) => e.name + '/' + f) : [e.name]));
      const id = (process.env.PWA_BUILD_ID || '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40)
        || crypto.createHash('sha256').update(lista(path.join(outDir, 'assets')).sort().join('|')).digest('hex').slice(0, 12);
      fs.writeFileSync(sw, fs.readFileSync(sw, 'utf8').replace(/__BUILD_ID__/g, id));
    },
  };
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    swBuildId(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
