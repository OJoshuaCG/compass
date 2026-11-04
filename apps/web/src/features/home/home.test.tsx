import type { Permission } from '@iam/contracts';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, problem, stubApi } from '../../test/fake-api';
import { es } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const MANAGED_COUNT = 3;
const INVENTORY_COUNT = 5;
const SESSIONS_COUNT = 2;

const listOf = (rows: unknown[], nextCursor: string | null = null) =>
  jsonResponse({ data: rows, page: { nextCursor, limit: 100 } });

const managedRows = (amount: number) =>
  Array.from({ length: amount }, (_, index) => ({
    id: crypto.randomUUID(),
    displayName: `Persona ${String(index)}`,
    email: `persona${String(index)}@example.com`,
    rank: 3,
    status: 'active',
    managedBy: null,
  }));

const accountRows = (amount: number) =>
  Array.from({ length: amount }, (_, index) => ({
    id: crypto.randomUUID(),
    platformId: crypto.randomUUID(),
    displayName: `Cuenta ${String(index)}`,
    handle: null,
    ownerGroupId: null,
    tags: [],
    status: 'active',
    myLevel: null,
    createdAt: '2030-01-01T10:00:00.000Z',
    lastChangedAt: null,
    passwordAge: 'unknown',
  }));

const sessionRows = (amount: number) =>
  Array.from({ length: amount }, () => ({
    id: crypto.randomUUID(),
    createdAt: '2030-01-01T10:00:00.000Z',
    lastSeenAt: '2030-01-01T11:00:00.000Z',
    expiresAt: '2030-01-02T10:00:00.000Z',
    userAgent: null,
    ip: null,
    current: false,
  }));

/** Tarjeta por su título: cada una es una región con nombre. */
const card = (title: string) => screen.getByRole('region', { name: title });

function setup(permissions: Permission[], overrides: Record<string, Response> = {}) {
  return stubApi({
    'GET /me': jsonResponse(meFixture({ permissions })),
    'GET /users/managed': listOf(managedRows(MANAGED_COUNT)),
    'GET /accounts/inventory': listOf(accountRows(INVENTORY_COUNT)),
    'GET /me/sessions': listOf(sessionRows(SESSIONS_COUNT)),
    ...overrides,
  });
}

describe('home summary', () => {
  it('shows the real counts and the shortcuts for a person who can read the inventory', async () => {
    setup(['vault.inventory.read']);
    const { container } = renderApp('/');
    expect(
      await within(
        await screen.findByRole('region', { name: es.common['home.team.title'] }),
      ).findByText(String(MANAGED_COUNT)),
    ).toBeInTheDocument();
    expect(
      await within(card(es.common['home.inventory.title'])).findByText(String(INVENTORY_COUNT)),
    ).toBeInTheDocument();
    expect(
      await within(card(es.common['home.sessions.title'])).findByText(String(SESSIONS_COUNT)),
    ).toBeInTheDocument();
    const shortcuts = screen.getByRole('region', { name: es.common['home.shortcuts.title'] });
    expect(
      within(shortcuts).getByRole('link', { name: new RegExp(es.common['nav.users']) }),
    ).toHaveAttribute('href', '/users');
    expect(
      within(shortcuts).getByRole('link', { name: new RegExp(es.common['nav.accounts']) }),
    ).toHaveAttribute('href', '/accounts');
    expect(
      within(shortcuts).getByRole('link', { name: new RegExp(es.common['nav.security']) }),
    ).toHaveAttribute('href', '/security');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('hides the inventory card and never asks for it without vault.inventory.read', async () => {
    const api = setup([]);
    renderApp('/');
    await within(
      await screen.findByRole('region', { name: es.common['home.team.title'] }),
    ).findByText(String(MANAGED_COUNT));
    expect(
      screen.queryByRole('region', { name: es.common['home.inventory.title'] }),
    ).not.toBeInTheDocument();
    expect(api.callsTo('GET', '/accounts/inventory')).toHaveLength(0);
  });

  it('asks for a single page of the maximum size to count', async () => {
    const api = setup([]);
    renderApp('/');
    await within(
      await screen.findByRole('region', { name: es.common['home.team.title'] }),
    ).findByText(String(MANAGED_COUNT));
    expect(api.callsTo('GET', '/users/managed')[0]?.search.get('limit')).toBe('100');
  });

  it('shows the empty text with an exact zero', async () => {
    setup([], { 'GET /users/managed': listOf([]) });
    renderApp('/');
    const team = await screen.findByRole('region', { name: es.common['home.team.title'] });
    expect(await within(team).findByText(es.common['home.team.empty'])).toBeInTheDocument();
    expect(within(team).getByText('0')).toBeInTheDocument();
  });

  it('does not invent a figure when more pages exist and the server sends no total', async () => {
    setup([], { 'GET /users/managed': listOf(managedRows(MANAGED_COUNT), 'next-page-cursor') });
    renderApp('/');
    const team = await screen.findByRole('region', { name: es.common['home.team.title'] });
    expect(await within(team).findByText(es.common['home.stat.unavailable'])).toBeInTheDocument();
    expect(within(team).queryByText(String(MANAGED_COUNT))).not.toBeInTheDocument();
  });

  it('shows a loading state while the figure is on its way', async () => {
    setup([], {
      'GET /me/sessions': new Promise<Response>(() => undefined) as unknown as Response,
    });
    renderApp('/');
    const sessions = await screen.findByRole('region', { name: es.common['home.sessions.title'] });
    expect(within(sessions).getByRole('status')).toHaveTextContent(es.common['state.loading']);
  });

  it('shows the error in the failed card only and offers to retry', async () => {
    setup([], { 'GET /users/managed': problem(500, 'INTERNAL') });
    renderApp('/');
    const team = await screen.findByRole('region', { name: es.common['home.team.title'] });
    expect(await within(team).findByRole('alert')).toBeInTheDocument();
    expect(
      within(team).getByRole('button', { name: es.common['actions.retry'] }),
    ).toBeInTheDocument();
    expect(
      await within(card(es.common['home.sessions.title'])).findByText(String(SESSIONS_COUNT)),
    ).toBeInTheDocument();
  });
});
