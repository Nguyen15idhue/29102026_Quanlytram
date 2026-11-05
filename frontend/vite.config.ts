import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const proxyTarget = process.env.VITE_PROXY_TARGET || 'http://localhost:4000';
const hmrClientPort = Number(process.env.VITE_HMR_CLIENT_PORT || 0);

// MapLibre v6 tự tạo worker bằng new URL('./maplibre-gl-worker.mjs', import.meta.url).
// Vite không emit file worker sang dist nên phải copy thủ công, nếu thiếu thì
// tile/marker không xử lý được ở bản build.
function copyMaplibreWorker(): Plugin {
  let root = process.cwd();
  return {
    name: 'copy-maplibre-worker',
    apply: 'build',
    configResolved(config) {
      root = config.root;
    },
    closeBundle() {
      const source = resolve(root, 'node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs');
      const target = resolve(root, 'dist/assets/maplibre-gl-worker.mjs');
      if (!existsSync(source)) {
        throw new Error(`Không tìm thấy worker MapLibre: ${source}`);
      }
      copyFileSync(source, target);
    }
  };
}

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
  plugins: [react(), serveGuideIndex(), copyMaplibreWorker()],
  optimizeDeps: {
    exclude: ['maplibre-gl']
  },
  worker: {
    format: 'es'
  },
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
