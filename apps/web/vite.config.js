import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5273,
    // Same-origin in dev, so the refresh cookie behaves exactly as it will in
    // production and there is no CORS special case to debug later.
    proxy: {
      '/api': { target: 'http://localhost:4100', changeOrigin: true },
      // Not under /api, and handy to hit from the dev origin.
      '/health': { target: 'http://localhost:4100', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
