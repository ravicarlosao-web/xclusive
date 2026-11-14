import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const rawPort = process.env.PORT_ADMIN || '23744';
const port = Number(rawPort);

// Caminho de acesso ao painel: SECRETO e definido fora do repositório (variável ADMIN_BASE_PATH, só o segmento, sem barras).
// Sem a variável, ou com formato inválido, o painel NÃO se constrói nem se serve (falha fechada): nunca cai em /admin.
// Formato: só letras minúsculas, números e hífens, 16 a 64 caracteres. Gerar, por exemplo, com: openssl rand -hex 16
const segmentoAdmin = process.env.ADMIN_BASE_PATH;
if (segmentoAdmin === undefined || segmentoAdmin === '') {
  throw new Error('ADMIN_BASE_PATH não está definida: o painel de admin não se constrói nem se serve sem o caminho secreto (defina-a fora do repositório).');
}
if (!/^[a-z0-9-]{16,64}$/.test(segmentoAdmin)) {
  throw new Error('ADMIN_BASE_PATH inválida: só letras minúsculas, números e hífens, com 16 a 64 caracteres (sem barras).');
}
const basePath = `/${segmentoAdmin}/`;

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
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
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
