import type { Permission } from '@iam/contracts';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, stubApi } from '../../test/fake-api';
import { es } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const c = es.common;

const SESSION = {
  createdAt: '2030-01-01T10:00:00.000Z',
  lastSeenAt: '2030-01-01T11:00:00.000Z',
  expiresAt: '2030-01-02T10:00:00.000Z',
  userAgent: null,
  ip: null,
};
const users = (count: number, nextCursor: string | null = null) =>
  jsonResponse({
    data: Array.from({ length: count }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      displayName: `Persona ${String(i)}`,
      email: `p${String(i)}@example.com`,
      rank: 3,
    })),
    page: { nextCursor, limit: 100 },
  });

function setup(permissions: Permission[] = []) {
  return stubApi({
    'GET /me': jsonResponse(meFixture({ permissions })),
    'GET /users': users(3),
    'GET /invitations': jsonResponse({
      data: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          email: 'vencida@example.com',
          rank: 3,
          createdAt: '2030-01-01T00:00:00.000Z',
          expiresAt: '2030-01-04T00:00:00.000Z',
          expired: true,
        },
      ],
    }),
    'GET /me/sessions': jsonResponse({
      data: [
        { ...SESSION, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', current: true },
        { ...SESSION, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', current: false },
      ],
    }),
    'GET /me/passkeys': jsonResponse({ data: [] }),
  });
}

describe('home screen', () => {
  it('greets by first name and shows the phase 1a metrics without accessibility violations', async () => {
    setup(['user.invite']);
    const { container } = renderApp('/');
    expect(
      await screen.findByRole('heading', { level: 1, name: c['home.title'] }),
    ).toBeInTheDocument();
    expect(screen.getByText(c['home.greeting'].replace('{{name}}', 'Ana'))).toBeInTheDocument();

    const people = await screen.findByRole('region', { name: c['home.stats.people'] });
    expect(await within(people).findByText('3')).toBeInTheDocument();
    const sessions = screen.getByRole('region', { name: c['home.stats.sessions'] });
    expect(await within(sessions).findByText('2')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: c['home.stats.invitations'] })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('lists what needs attention, with links to where it is resolved', async () => {
    setup(['user.invite']);
    renderApp('/');
    const panel = await screen.findByRole('region', { name: c['home.attention.title'] });
    expect(
      await within(panel).findByText(
        c['home.attention.invitationExpired'].replace('{{email}}', 'vencida@example.com'),
      ),
    ).toBeInTheDocument();
    expect(within(panel).getByText(c['home.attention.noPasskey'])).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: c['home.attention.register'] })).toHaveAttribute(
      'href',
      '/security',
    );
    expect(
      within(panel).getByText(c['home.attention.otherSessions_one'].replace('{{count}}', '1')),
    ).toBeInTheDocument();
  });

  it('does not ask for invitations without the invite permission', async () => {
    const api = setup();
    renderApp('/');
    await screen.findByRole('region', { name: c['home.stats.people'] });
    expect(screen.queryByRole('region', { name: c['home.stats.invitations'] })).toBeNull();
    expect(api.callsTo('GET', '/invitations')).toHaveLength(0);
  });

  it('shows "100+" when the directory has more than one page', async () => {
    setup();
    stubApi({
      'GET /me': jsonResponse(meFixture()),
      'GET /users': users(100, 'next'),
      'GET /me/sessions': jsonResponse({ data: [] }),
      'GET /me/passkeys': jsonResponse({ data: [] }),
    });
    renderApp('/');
    const people = await screen.findByRole('region', { name: c['home.stats.people'] });
    expect(await within(people).findByText('100+')).toBeInTheDocument();
  });
});
