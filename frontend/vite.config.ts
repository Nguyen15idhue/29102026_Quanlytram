import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const proxyTarget = process.env.VITE_PROXY_TARGET || 'http://localhost:4000';
const hmrClientPort = Number(process.env.VITE_HMR_CLIENT_PORT || 0);

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    watch: {
      usePolling: true,
      interval: 1000
    },
    hmr: hmrClientPort > 0 ? { clientPort: hmrClientPort } : undefined,
    proxy: {
      '/api': proxyTarget,
      '/socket.io': {
        target: proxyTarget,
        ws: true
      },
      '/health': proxyTarget
    }
  }
});
