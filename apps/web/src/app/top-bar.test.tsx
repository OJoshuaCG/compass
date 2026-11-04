import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { jsonResponse, meFixture, stubApi } from '../test/fake-api';
import { es } from '../test/helpers';
import { renderApp } from '../test/render-app';
import { openUserMenu } from '../test/user-menu';

const ME_DISPLAY_NAME = meFixture().user.displayName;

describe('top bar', () => {
  // El chip de rango vive en el encabezado del menú de usuario, no suelto en la barra.
  it.each([0, 1, 2, 3] as const)(
    'shows the rank chip of the signed-in person in the user menu (rank %s)',
    async (rank) => {
      const user = userEvent.setup();
      stubApi({ 'GET /me': jsonResponse(meFixture({ rank })) });
      renderApp('/');

      await screen.findByRole('banner');
      await openUserMenu(user, ME_DISPLAY_NAME);
      const menu = await screen.findByRole('menu');
      expect(menu).toHaveTextContent(es.common[`rank.${String(rank) as '0'}`]);
    },
  );
});
