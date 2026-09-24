import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(root, '../..');

/**
 * Dev-хост фронтенда (браузерная разработка / live preview).
 * Продакшн-десктоп собирается Tauri (Этап 15) и не зависит от этого хоста.
 */
export default defineConfig({
  root,
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Плейсхолдер-хост песочницы должен открывать приложение.
    allowedHosts: true,
    fs: { allow: [repoRoot] },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: true,
    target: 'es2022'
  }
});
