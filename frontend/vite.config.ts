import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const proxyTarget = process.env.VITE_PROXY_TARGET || 'http://localhost:4000';
const hmrClientPort = Number(process.env.VITE_HMR_CLIENT_PORT || 0);

function serveGuideIndex(): Plugin {
  return {
    name: 'serve-guide-index',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url && (req.url === '/guide' || req.url.startsWith('/guide/'))) {
          const [rawPath, query] = req.url.split('?');
          const pathname = rawPath.split('#')[0];
          const hasExtension = /\.[a-z0-9]+$/i.test(pathname);
          if (!hasExtension) {
            const base = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
            req.url = `${base}/index.html${query ? `?${query}` : ''}`;
          }
        }
        next();
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), serveGuideIndex()],
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
