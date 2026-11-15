import type { Account, CredentialHealth, Credential } from '@iam/contracts';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, problem, stubApi } from '../../test/fake-api';
import { es } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const ACCOUNT_ID = '33333333-3333-4333-8333-333333333331';
const PLATFORM_ID = '11111111-1111-4111-8111-111111111111';
const WEAK_ID = '44444444-4444-4444-8444-444444444441';
const CLEAN_ID = '44444444-4444-4444-8444-444444444442';
const UNMEASURED_ID = '44444444-4444-4444-8444-444444444443';

const account: Account = {
  id: ACCOUNT_ID,
  platformId: PLATFORM_ID,
  displayName: 'Nómina',
  handle: null,
  ownerGroupId: null,
  tags: [],
  status: 'active',
  myLevel: 'VIEW',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const credential = (id: string, label: string): Credential => ({
  id,
  accountId: ACCOUNT_ID,
  label,
  kind: 'password',
  lastRotatedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
});

const credentials = [
  credential(WEAK_ID, 'Portal débil'),
  credential(CLEAN_ID, 'Portal sano'),
  credential(UNMEASURED_ID, 'Portal sin medir'),
];

const health: CredentialHealth[] = [
  { credentialId: WEAK_ID, signals: ['weak_password', 'totp_missing'], strengthScore: 2 },
  { credentialId: CLEAN_ID, signals: [], strengthScore: 4 },
  { credentialId: UNMEASURED_ID, signals: ['rotation_pending'], strengthScore: null },
];

const PAGE = `/accounts/${ACCOUNT_ID}/credentials`;
const copy = es.credentials;

function setup(healthResponse: Response) {
  return stubApi({
    'GET /me': jsonResponse(meFixture({ permissions: [], rank: 1 })),
    [`GET /accounts/${ACCOUNT_ID}`]: jsonResponse(account),
    [`GET /accounts/${ACCOUNT_ID}/credentials`]: jsonResponse({ data: credentials }),
    [`GET /accounts/${ACCOUNT_ID}/health`]: healthResponse,
  });
}

const rowOf = async (label: string) =>
  within(
    await screen
      .findByRole('cell', { name: label })
      .then((cell) => cell.closest('tr') as HTMLElement),
  );

describe('credential health', () => {
  it('shows signals, strength and the no-alerts text per credential, without violations', async () => {
    setup(jsonResponse({ data: health }));
    const { container } = renderApp(PAGE);

    const weakRow = await rowOf('Portal débil');
    expect(await weakRow.findByText(copy['health.signal.weak_password'])).toBeInTheDocument();
    expect(weakRow.getByText(copy['health.signal.totp_missing'])).toBeInTheDocument();
    expect(
      weakRow.getByText(copy['health.score.value'].replace('{{score}}', '2')),
    ).toBeInTheDocument();

    const cleanRow = await rowOf('Portal sano');
    expect(await cleanRow.findByText(copy['health.none'])).toBeInTheDocument();
    expect(
      cleanRow.getByText(copy['health.score.value'].replace('{{score}}', '4')),
    ).toBeInTheDocument();

    expect(await axeViolations(container)).toEqual([]);
  });

  it('shows "not measured" when the score is null', async () => {
    setup(jsonResponse({ data: health }));
    renderApp(PAGE);

    const row = await rowOf('Portal sin medir');
    expect(await row.findByText(copy['health.signal.rotation_pending'])).toBeInTheDocument();
    expect(row.getByText(copy['health.score.unmeasured'])).toBeInTheDocument();
  });

  it('keeps the credentials list working when the health query fails', async () => {
    setup(problem(500, 'INTERNAL_ERROR'));
    const { container } = renderApp(PAGE);

    expect(await screen.findByText(copy['health.unavailable'])).toBeInTheDocument();
    const table = screen.getByRole('table', { name: copy.caption });
    expect(within(table).getByRole('cell', { name: 'Portal débil' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: 'Portal sano' })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });
});
