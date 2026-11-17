import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  // the wasm package and the example scenarios live outside apps/web
  server: { fs: { allow: ['../..'] } },
  optimizeDeps: { exclude: ['pattern-engine-wasm'] },
});
