import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { jsonResponse, meFixture, stubApi } from '../test/fake-api';
import { es } from '../test/helpers';
import { renderApp } from '../test/render-app';

describe('top bar', () => {
  it.each([0, 1, 2, 3] as const)(
    'shows the rank chip of the signed-in person (rank %s)',
    async (rank) => {
      stubApi({ 'GET /me': jsonResponse(meFixture({ rank })) });
      renderApp('/');

      const banner = await screen.findByRole('banner');
      expect(
        await within(banner).findByText(es.common[`rank.${String(rank) as '0'}`]),
      ).toBeVisible();
    },
  );
});
