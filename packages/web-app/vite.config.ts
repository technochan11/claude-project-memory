import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname, 'src/client'),
  plugins: [react()],
  resolve: {
    alias: {
      '@cpm/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  server: {
    port: 47824,
    proxy: {
      '/api': 'http://localhost:47823',
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/client'),
    emptyOutDir: true,
  },
});
