import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // Márgenes amplios: en CI y con varias tareas en paralelo jsdom puede tardar varios segundos.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
