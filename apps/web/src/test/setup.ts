import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
  // Las preferencias de idioma no deben filtrarse entre pruebas.
  window.localStorage.clear();
});

// `findBy*` y `waitFor` esperan 1 s por defecto: poco si la máquina está saturada.
configure({ asyncUtilTimeout: 8_000 });
