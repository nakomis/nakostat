/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    // Claude Code sessions set TEST_MAX_WORKERS (~/.claude/settings.json) so parallel agents don't
    // swamp the Mac; unset (your terminal, CI) keeps Vitest's default.
    ...(process.env.TEST_MAX_WORKERS && { maxWorkers: Number(process.env.TEST_MAX_WORKERS) }),
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        'src/main.tsx',
        'src/router.tsx',
        'src/vite-env.d.ts',
        'src/components/ui/**',
      ],
      thresholds: { lines: 70 },
    },
  },
});
