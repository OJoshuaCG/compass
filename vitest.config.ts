import { defineConfig } from 'vitest/config';

// Contenedor de proyectos: permite ejecutar pruebas desde la raíz indicando archivos
// (`pnpm exec vitest run <ruta>`), cada uno con la configuración de su paquete.
// No define pruebas propias; la lista es explícita para no recoger carpetas sin pruebas.
export default defineConfig({
  test: {
    projects: [
      'apps/api/vitest.config.ts',
      'apps/web/vite.config.ts',
      'packages/ui/vitest.config.ts',
      'packages/contracts/vitest.config.ts',
      'packages/i18n',
      'db/vitest.config.ts',
    ],
  },
});
