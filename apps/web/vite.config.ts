import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // shared with the server; the web app bundles the TypeScript sources
      '@pattern/design-lint': fileURLToPath(new URL('../../packages/design-lint/src/index.ts', import.meta.url)),
    },
  },
  worker: { format: 'es' },
  server: {
    // the wasm package, examples and levels live outside apps/web
    fs: { allow: ['../..'] },
    // NestJS (apps/server) for level submissions and leaderboards
    proxy: { '/api': 'http://localhost:3000' },
  },
  optimizeDeps: { exclude: ['pattern-engine-wasm'] },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          flow: ['@xyflow/react'],
          ui: ['radix-ui', 'lucide-react'],
        },
      },
    },
  },
});
