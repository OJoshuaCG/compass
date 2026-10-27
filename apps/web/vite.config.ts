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
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Los CSS no aportan a las pruebas de comportamiento y jsdom no calcula estilos.
    css: false,
  },
});
