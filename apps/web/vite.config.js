import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * When the API is not running, Vite's proxy answers with a bare 500, which
 * reads like an application bug rather than "nothing is listening on 4100".
 * This turns it into a 503 that says what to do.
 */
function explainProxyFailures(proxy) {
  proxy.on('error', (err, _req, res) => {
    const unreachable = err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET';

    // Websocket upgrades hand us a raw socket, which has no writeHead.
    if (typeof res?.writeHead !== 'function') return;
    if (res.headersSent) return;

    res.writeHead(unreachable ? 503 : 502, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: {
          code: unreachable ? 'API_NOT_RUNNING' : 'API_UNREACHABLE',
          message: unreachable
            ? 'The API is not running. Start it in another terminal with: npm run dev'
            : `Could not reach the API on port 4100 (${err.code ?? err.message}).`,
        },
      })
    );
  });
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5273,
    // Same-origin in dev, so the refresh cookie behaves exactly as it will in
    // production and there is no CORS special case to debug later.
    proxy: {
      '/api': {
        target: 'http://localhost:4100',
        changeOrigin: true,
        configure: explainProxyFailures,
      },
      // Not under /api, and handy to hit from the dev origin.
      '/health': {
        target: 'http://localhost:4100',
        changeOrigin: true,
        configure: explainProxyFailures,
      },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
