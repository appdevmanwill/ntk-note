import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Isolated test server. No Cloudflare runtime or production deployment hooks.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  optimizeDeps: { entries: ['index.html', 'tests/browser/fixture.ts'] },
});
