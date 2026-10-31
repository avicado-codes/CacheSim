import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Relative asset URLs, so the build works from any path (Cloudflare Pages, GitHub Pages).
  base: './',
  worker: { format: 'es' },
  // Demo traces and the standard dataset are imported straight from tests/data, so the
  // site and the native test suites share one copy of every trace.
  server: { fs: { allow: [repoRoot] } },
  // The largest chunk is ECharts (about 180 kB gzipped), loaded only with the Analytics and
  // Comparison views; the first paint needs about 60 kB.
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 600 },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
