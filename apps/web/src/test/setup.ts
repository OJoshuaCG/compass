import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
  // Las preferencias de idioma no deben filtrarse entre pruebas.
  window.localStorage.clear();
});
