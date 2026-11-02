import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, problem, stubApi } from '../../test/fake-api';
import { es, expectNoSecretsStored, field } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const SETUP_TOKEN = 'setup_0123456789abcdefghijklmnopqrstuv';
const ROOT_PASSWORD = 'correct horse battery staple';
const ORGANIZATION_ID = '3f2a6a0e-62a8-4f3e-9d57-6a0f6d0f8c11';
const EMERGENCY_CODES = [
  { code: 'AAAA-1111-BBBB', custodyGroup: 'A' },
  { code: 'CCCC-2222-DDDD', custodyGroup: 'A' },
  { code: 'EEEE-3333-FFFF', custodyGroup: 'B' },
  { code: 'GGGG-4444-HHHH', custodyGroup: 'B' },
];

async function fillSetupForm(user: ReturnType<typeof userEvent.setup>, password: string) {
  await user.type(field(es.auth['setup.organizationName']), 'Acme Corp');
  await user.type(field(es.auth['setup.organizationSlug']), 'acme');
  await user.type(field(es.auth['setup.rootDisplayName']), 'Ana Root');
  await user.type(field(es.auth['setup.rootEmail']), 'ana@example.com');
  await user.type(field(es.auth['setup.password']), password);
}

describe('first organization setup (/setup)', () => {
  it('creates the organization with the fragment token, shows the codes once and removes the token from the URL', async () => {
    const user = userEvent.setup();
    const api = stubApi({
      'GET /me': problem(401, 'AUTHZ.SESSION'),
      'POST /setup': jsonResponse(
        { organizationId: ORGANIZATION_ID, emergencyCodes: EMERGENCY_CODES },
        201,
      ),
    });
    const { router, container, queryClient } = renderApp(`/setup#token=${SETUP_TOKEN}`);

    await screen.findByRole('heading', { level: 1, name: es.auth['setup.title'] });
    expect(router.state.location.hash).toBe('');
    expect(await axeViolations(container)).toEqual([]);

    await fillSetupForm(user, ROOT_PASSWORD);
    await user.click(screen.getByRole('button', { name: es.auth['setup.submit'] }));

    await screen.findByRole('heading', { level: 1, name: es.auth['setup.codes.title'] });
    expect(api.callsTo('POST', '/setup')[0]?.body).toEqual({
      token: SETUP_TOKEN,
      organizationName: 'Acme Corp',
      organizationSlug: 'acme',
      rootEmail: 'ana@example.com',
      rootDisplayName: 'Ana Root',
      password: ROOT_PASSWORD,
    });
    expect(screen.getByText(/AAAA-1111-BBBB/)).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
    expectNoSecretsStored(queryClient, [ROOT_PASSWORD, SETUP_TOKEN, 'AAAA-1111-BBBB']);
  });

  it('sends a base64 token intact: "+" is not turned into a space, "/" and "=" survive', async () => {
    const user = userEvent.setup();
    const base64Token = 'ab+cd/efGHijKLmnOPqrSTuvWXyz0123456789+/AB==';
    const api = stubApi({
      'GET /me': problem(401, 'AUTHZ.SESSION'),
      'POST /setup': jsonResponse(
        { organizationId: ORGANIZATION_ID, emergencyCodes: EMERGENCY_CODES },
        201,
      ),
    });
    renderApp(`/setup#token=${base64Token}`);

    await screen.findByRole('heading', { level: 1, name: es.auth['setup.title'] });
    await fillSetupForm(user, ROOT_PASSWORD);
    await user.click(screen.getByRole('button', { name: es.auth['setup.submit'] }));

    await screen.findByRole('heading', { level: 1, name: es.auth['setup.codes.title'] });
    expect((api.callsTo('POST', '/setup')[0]?.body as { token: string }).token).toBe(base64Token);
  });

  it('shows the same neutral "invalid link" message when the server answers NOT_FOUND', async () => {
    const user = userEvent.setup();
    stubApi({
      'GET /me': problem(401, 'AUTHZ.SESSION'),
      'POST /setup': problem(404, 'NOT_FOUND'),
    });
    const { container } = renderApp(`/setup#token=${SETUP_TOKEN}`);

    await screen.findByRole('heading', { level: 1, name: es.auth['setup.title'] });
    await fillSetupForm(user, ROOT_PASSWORD);
    await user.click(screen.getByRole('button', { name: es.auth['setup.submit'] }));

    await screen.findByRole('heading', { level: 1, name: es.auth['setup.closed.title'] });
    expect(screen.getByText(es.auth['setup.closed.description'])).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('shows a password policy rejection in the password field and keeps the form', async () => {
    const user = userEvent.setup();
    const api = stubApi({
      'GET /me': problem(401, 'AUTHZ.SESSION'),
      'POST /setup': problem(422, 'PASSWORD.WEAK'),
    });
    renderApp(`/setup#token=${SETUP_TOKEN}`);

    await screen.findByRole('heading', { level: 1, name: es.auth['setup.title'] });
    await fillSetupForm(user, 'aaaaaaaaaaaa');
    await user.click(screen.getByRole('button', { name: es.auth['setup.submit'] }));

    expect(await screen.findByText(es.errors['PASSWORD.WEAK'])).toBeInTheDocument();
    expect(api.callsTo('POST', '/setup')).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 1, name: es.auth['setup.title'] }),
    ).toBeInTheDocument();
  });

  it('does not call the API and explains the problem when the link has no token', async () => {
    const api = stubApi({ 'GET /me': problem(401, 'AUTHZ.SESSION') });
    renderApp('/setup');

    await screen.findByRole('heading', { level: 1, name: es.auth['setup.closed.title'] });
    expect(screen.getByText(es.auth['setup.missingToken'])).toBeInTheDocument();
    expect(api.callsTo('POST', '/setup')).toHaveLength(0);
  });
});
