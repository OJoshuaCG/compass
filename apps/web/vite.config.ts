import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Sin estilos en línea (CSP): el CSS siempre sale en archivos, nunca incrustado.
    assetsInlineLimit: 0,
    cssCodeSplit: true,
  },
  test: {
    environment: 'jsdom',
    // Márgenes amplios: en CI y con varias tareas en paralelo jsdom puede tardar varios segundos.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Los CSS no aportan a las pruebas de comportamiento y jsdom no calcula estilos.
    css: false,
  },
});
