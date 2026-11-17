import { MAX_SAVED_VIEWS } from '@iam/contracts';
import type { AccountListItem, ProblemDetails, Role, SavedAccountView } from '@iam/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  STRONG_PASSWORD,
  TestClient,
  enroll,
  inviteAndOnboard,
  startEnvironment,
} from './support/e2e.js';
import type { E2eEnvironment, EnrolledSession } from './support/e2e.js';

// Fase 1b, T5: vistas guardadas por persona del listado «Mis cuentas».
// Regla de seguridad: una vista es una preferencia propia; nadie ve ni borra las de otra persona y
// aplicarla nunca amplía el acceso (el listado vuelve a filtrar por acceso efectivo).

let env: E2eEnvironment;
let root: EnrolledSession;
let operator: EnrolledSession;
let other: EnrolledSession;

const listViews = async (session: EnrolledSession): Promise<SavedAccountView[]> => {
  const response = await session.client.get<{ data: SavedAccountView[] }>('/account-views');
  expect(response.status).toBe(200);
  return response.body.data;
};

beforeAll(async () => {
  env = await startEnvironment(inject('adminUrl'));
  await env.bootstrapOrganization({
    slug: 'views',
    rootEmail: 'root@views.test',
    rootName: 'Ada Lovelace',
  });
  const rootClient = new TestClient(env, '203.0.113.90');
  await rootClient.post('/auth/login', { email: 'root@views.test', password: STRONG_PASSWORD });
  root = await enroll(env, rootClient);

  const roles = (await root.client.get<{ data: Role[] }>('/roles')).body.data;
  const operatorRoleId = roles.find((role) => role.name === 'Operator')?.id ?? '';
  operator = await inviteAndOnboard(env, root.client, {
    email: 'operator@views.test',
    rank: 3,
    roleIds: [operatorRoleId],
  });
  other = await inviteAndOnboard(env, root.client, {
    email: 'other@views.test',
    rank: 3,
    roleIds: [operatorRoleId],
  });
});

afterAll(async () => {
  await env.close();
});

describe('saved account views', () => {
  it('saves a view with a text, a quick filter or both, and lists it', async () => {
    const byText = await operator.client.post<SavedAccountView>('/account-views', {
      name: 'Banco',
      q: 'banco',
    });
    expect(byText.status).toBe(201);
    expect(byText.body).toMatchObject({ name: 'Banco', q: 'banco', filter: null });

    const byFilter = await operator.client.post<SavedAccountView>('/account-views', {
      name: 'Sin 2FA',
      filter: 'no-2fa',
    });
    expect(byFilter.status).toBe(201);
    expect(byFilter.body).toMatchObject({ q: null, filter: 'no-2fa' });

    const both = await operator.client.post<SavedAccountView>('/account-views', {
      name: 'Por rotar del banco',
      q: 'banco',
      filter: 'review',
    });
    expect(both.status).toBe(201);

    const names = (await listViews(operator)).map((view) => view.name);
    expect(names).toEqual(['Banco', 'Por rotar del banco', 'Sin 2FA']);
  });

  it('rejects a view with no search text and no quick filter', async () => {
    const response = await operator.client.post<ProblemDetails>('/account-views', {
      name: 'Vacía',
    });
    expect(response.status).toBe(422);
  });

  it('rejects a repeated name for the same person, ignoring case', async () => {
    const response = await operator.client.post<ProblemDetails>('/account-views', {
      name: 'BANCO',
      q: 'otro',
    });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('SAVED_VIEW.NAME_TAKEN');
  });

  it('lets another person use the same name', async () => {
    const response = await other.client.post<SavedAccountView>('/account-views', {
      name: 'Banco',
      q: 'banco',
    });
    expect(response.status).toBe(201);
  });

  it('never lists or deletes the views of another person', async () => {
    const operatorViews = await listViews(operator);
    const otherViews = await listViews(other);
    expect(otherViews).toHaveLength(1);
    const foreignId = operatorViews[0]?.id ?? '';
    expect(otherViews.some((view) => view.id === foreignId)).toBe(false);

    const attempt = await other.client.request<ProblemDetails>(
      'DELETE',
      `/account-views/${foreignId}`,
    );
    expect(attempt.status).toBe(404);
    expect(attempt.body.code).toBe('SAVED_VIEW.NOT_FOUND');
    expect((await listViews(operator)).some((view) => view.id === foreignId)).toBe(true);
  });

  it('deletes an own view', async () => {
    const created = await operator.client.post<SavedAccountView>('/account-views', {
      name: 'Temporal',
      q: 'temporal',
    });
    const removed = await operator.client.request('DELETE', `/account-views/${created.body.id}`);
    expect(removed.status).toBe(204);
    expect((await listViews(operator)).some((view) => view.id === created.body.id)).toBe(false);
  });

  it('refuses to save more than the maximum per person', async () => {
    const existing = (await listViews(root)).length;
    for (let index = existing; index < MAX_SAVED_VIEWS; index += 1) {
      const response = await root.client.post('/account-views', {
        name: `Vista ${String(index)}`,
        q: `texto ${String(index)}`,
      });
      expect(response.status).toBe(201);
    }
    const overflow = await root.client.post<ProblemDetails>('/account-views', {
      name: 'Una de más',
      q: 'extra',
    });
    expect(overflow.status).toBe(422);
    expect(overflow.body.code).toBe('SAVED_VIEW.LIMIT_REACHED');
  });

  it('keeps the account list behind effective access when a view is applied', async () => {
    const account = await operator.client.post<AccountListItem>('/accounts', {
      platformId: (await operator.client.get<{ data: { id: string }[] }>('/platforms')).body.data[0]
        ?.id,
      displayName: 'Banco Privado',
    });
    expect(account.status).toBe(201);

    const viewQuery = new URLSearchParams({ q: 'banco' }).toString();
    const mine = await operator.client.get<{ data: AccountListItem[] }>(`/accounts?${viewQuery}`);
    expect(mine.body.data.map((item) => item.displayName)).toContain('Banco Privado');
    const theirs = await other.client.get<{ data: AccountListItem[] }>(`/accounts?${viewQuery}`);
    expect(theirs.body.data.map((item) => item.displayName)).not.toContain('Banco Privado');
  });

  it('never exceeds the maximum when several saves arrive at the same time', async () => {
    const existing = (await listViews(other)).length;
    const attempts = MAX_SAVED_VIEWS + 5;
    const responses = await Promise.all(
      Array.from({ length: attempts }, (_, index) =>
        other.client.post('/account-views', {
          name: `Concurrente ${String(index)}`,
          q: `concurrente ${String(index)}`,
        }),
      ),
    );
    const created = responses.filter((response) => response.status === 201).length;
    expect(created).toBe(MAX_SAVED_VIEWS - existing);
    expect((await listViews(other)).length).toBe(MAX_SAVED_VIEWS);
  });

  it('requires a session for every route', async () => {
    const guest = new TestClient(env, '198.51.100.91');
    expect((await guest.get('/account-views')).status).toBe(401);
    expect((await guest.post('/account-views', { name: 'x', q: 'x' })).status).toBe(401);
    expect(
      (await guest.request('DELETE', '/account-views/00000000-0000-7000-8000-000000000000')).status,
    ).toBe(401);
  });
});
