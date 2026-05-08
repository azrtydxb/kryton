import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    extensions: ['.web.tsx', '.web.ts', '.tsx', '.ts', '.jsx', '.js', '.json'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/plugins': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/version': { target: 'http://localhost:3001', changeOrigin: true },
      '/healthz': { target: 'http://localhost:3001', changeOrigin: true },
      '/readyz': { target: 'http://localhost:3001', changeOrigin: true },
      '/docs': { target: 'http://localhost:3001', changeOrigin: true },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
});
