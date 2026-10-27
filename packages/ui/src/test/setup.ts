import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// Sin `globals`, Testing Library no limpia el DOM solo entre pruebas.
afterEach(cleanup);

// `findBy*` y `waitFor` esperan 1 s por defecto: poco si la máquina está saturada.
configure({ asyncUtilTimeout: 8_000 });
