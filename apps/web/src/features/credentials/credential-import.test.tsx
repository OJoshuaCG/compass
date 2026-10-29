import type { CredentialImportPreview, CredentialImportRow, Permission } from '@iam/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, problem, stubApi } from '../../test/fake-api';
import { es, expectNoSecretsStored } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const PAGE = '/credentials/import';
const PREVIEW_PATH = '/credentials/import/preview';
const COMMIT_PATH = '/credentials/import';

const PASSWORD = 'S3cr3t-de-prueba-Ωmega';
const USERNAME = 'ana.import@example.com';
const CSV_TEXT = [
  'platform,account_name,credential_label,username,password',
  `GitHub,Equipo Web,Admin,${USERNAME},${PASSWORD}`,
  '',
].join('\n');

const PERMISSIONS: Permission[] = ['account.create', 'credential.create'];

const t = es.credentials;
const fill = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce(
    (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
    template,
  );

const VALID_ROW: CredentialImportRow = {
  line: 2,
  status: 'valid',
  errorCodes: [],
  duplicateReason: null,
  platform: 'GitHub',
  accountName: 'Equipo Web',
  credentialLabel: 'Admin',
};
const DUPLICATE_ROW: CredentialImportRow = {
  line: 3,
  status: 'duplicate',
  errorCodes: [],
  duplicateReason: 'existing',
  platform: 'GitHub',
  accountName: 'Nómina',
  credentialLabel: 'Portal',
};
const INVALID_ROW: CredentialImportRow = {
  line: 4,
  status: 'invalid',
  errorCodes: ['PLATFORM_UNKNOWN', 'PASSWORD_REQUIRED'],
  duplicateReason: null,
  platform: 'Plataforma Rara',
  accountName: 'Cuenta rota',
  credentialLabel: 'Etiqueta rota',
};

function previewOf(rows: CredentialImportRow[]): CredentialImportPreview {
  const count = (status: CredentialImportRow['status']) =>
    rows.filter((row) => row.status === status).length;
  return {
    totalRows: rows.length,
    validRows: count('valid'),
    invalidRows: count('invalid'),
    duplicateRows: count('duplicate'),
    rows,
  };
}

const csvFile = (name = 'cuentas.csv', content = CSV_TEXT) =>
  new File([content], name, { type: 'text/csv' });

function setup(routes: Parameters<typeof stubApi>[0] = {}) {
  return stubApi({
    'GET /me': jsonResponse(meFixture({ permissions: PERMISSIONS, rank: 1 })),
    ...routes,
  });
}

/** Sube el archivo y espera a que la vista previa (o el error) termine de pintarse. */
async function chooseFile(file: File = csvFile()) {
  // `applyAccept: false` para poder probar la comprobación propia de la extensión.
  const user = userEvent.setup({ applyAccept: false });
  const input = await screen.findByLabelText(t['import.file.label']);
  await user.upload(input, file);
  return { user, input };
}

const confirmButton = () => screen.getByRole('button', { name: t['import.action.confirm'] });
const summaryValue = (label: string) => screen.getByText(label).nextElementSibling?.textContent;
const findMessage = (text: string) => screen.findByText((content) => content.includes(text));

describe('credential import: preview', () => {
  it('shows the summary and one row per line with status and translated error codes', async () => {
    const api = setup({
      [`POST ${PREVIEW_PATH}`]: jsonResponse(previewOf([VALID_ROW, DUPLICATE_ROW, INVALID_ROW])),
    });
    const { container } = renderApp(PAGE);
    await chooseFile();

    const table = await screen.findByRole('table', { name: t['import.table.caption'] });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((header) => header.textContent);
    expect(headers).toEqual([
      t['import.col.line'],
      t['import.col.platform'],
      t['import.col.account'],
      t['import.col.label'],
      t['import.col.status'],
      t['import.col.details'],
    ]);
    expect(within(table).getByRole('cell', { name: 'Equipo Web' })).toBeInTheDocument();
    expect(within(table).getByText(t['import.status.valid'])).toBeInTheDocument();
    expect(within(table).getByText(t['import.status.duplicate'])).toBeInTheDocument();
    expect(within(table).getByText(t['import.status.invalid'])).toBeInTheDocument();
    expect(within(table).getByText(t['import.rowError.PLATFORM_UNKNOWN'])).toBeInTheDocument();
    expect(within(table).getByText(t['import.rowError.PASSWORD_REQUIRED'])).toBeInTheDocument();
    expect(within(table).getByText(t['import.duplicate.existing'])).toBeInTheDocument();

    expect(summaryValue(t['import.summary.total'])).toBe('3');
    expect(summaryValue(t['import.summary.valid'])).toBe('1');
    expect(summaryValue(t['import.summary.invalid'])).toBe('1');
    expect(summaryValue(t['import.summary.duplicate'])).toBe('1');

    // Se manda el texto tal cual, en el cuerpo y nada más.
    const calls = api.callsTo('POST', PREVIEW_PATH);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({ csv: CSV_TEXT });
    expect(await axeViolations(container)).toEqual([]);
  });

  it('paginates in memory so the table never paints more than the page limit', async () => {
    const manyRows: CredentialImportRow[] = Array.from({ length: 30 }, (_, index) => ({
      ...VALID_ROW,
      line: index + 2,
      accountName: `Cuenta ${String(index + 2)}`,
    }));
    setup({ [`POST ${PREVIEW_PATH}`]: jsonResponse(previewOf(manyRows)) });
    renderApp(PAGE);
    const { user } = await chooseFile();

    const table = await screen.findByRole('table', { name: t['import.table.caption'] });
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 25);
    await user.click(screen.getByRole('button', { name: es.common['table.next'] }));
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 5);
    expect(within(table).getByRole('cell', { name: 'Cuenta 31' })).toBeInTheDocument();
  });

  it('rejects a file that is not .csv without reading it or calling the API', async () => {
    const api = setup();
    renderApp(PAGE);
    await chooseFile(csvFile('cuentas.txt'));

    expect(await findMessage(t['import.file.notCsv'])).toBeInTheDocument();
    expect(api.callsTo('POST', PREVIEW_PATH)).toHaveLength(0);
  });

  it('rejects a file over 1,000,000 bytes without calling the API', async () => {
    const api = setup();
    renderApp(PAGE);
    await chooseFile(csvFile('grande.csv', 'a'.repeat(1_000_001)));

    expect(await findMessage(es.errors['CREDENTIAL_IMPORT.FILE_TOO_LARGE'])).toBeInTheDocument();
    expect(api.callsTo('POST', PREVIEW_PATH)).toHaveLength(0);
  });

  it('translates a whole-file error from the server', async () => {
    setup({ [`POST ${PREVIEW_PATH}`]: problem(422, 'CREDENTIAL_IMPORT.HEADER_INVALID') });
    renderApp(PAGE);
    await chooseFile();

    expect(await findMessage(es.errors['CREDENTIAL_IMPORT.HEADER_INVALID'])).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: t['import.table.caption'] })).toBeNull();
  });

  it('shows the translated permission error when the preview is denied (403)', async () => {
    setup({ [`POST ${PREVIEW_PATH}`]: problem(403, 'AUTHZ.PERMISSION') });
    renderApp(PAGE);
    await chooseFile();

    expect(await findMessage(es.errors['AUTHZ.PERMISSION'])).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t['import.action.confirm'] })).toBeNull();
  });
});

describe('credential import: confirm', () => {
  it('disables Confirm while there are invalid rows and never calls the commit', async () => {
    const api = setup({
      [`POST ${PREVIEW_PATH}`]: jsonResponse(previewOf([VALID_ROW, INVALID_ROW])),
    });
    renderApp(PAGE);
    await chooseFile();

    await screen.findByRole('table', { name: t['import.table.caption'] });
    expect(confirmButton()).toBeDisabled();
    expect(await findMessage(t['import.blocked.invalid'])).toBeInTheDocument();
    expect(api.callsTo('POST', COMMIT_PATH)).toHaveLength(0);
  });

  it('disables Confirm when every row is a duplicate (nothing to create)', async () => {
    setup({ [`POST ${PREVIEW_PATH}`]: jsonResponse(previewOf([DUPLICATE_ROW])) });
    renderApp(PAGE);
    await chooseFile();

    await screen.findByRole('table', { name: t['import.table.caption'] });
    expect(confirmButton()).toBeDisabled();
    expect(await findMessage(t['import.blocked.nothing'])).toBeInTheDocument();
  });

  // SENSIBLE (revisión humana): el CSV y la contraseña no quedan en DOM, cachés, almacenamiento ni URL.
  it('imports, shows the counts and leaves no secret in the DOM, caches, storage or URL', async () => {
    const api = setup({
      [`POST ${PREVIEW_PATH}`]: jsonResponse(previewOf([VALID_ROW, DUPLICATE_ROW])),
      [`POST ${COMMIT_PATH}`]: jsonResponse(
        { accountsCreated: 1, credentialsCreated: 1, duplicatesSkipped: 1 },
        201,
      ),
    });
    const { router, queryClient } = renderApp(PAGE);
    const { user } = await chooseFile();

    await screen.findByRole('table', { name: t['import.table.caption'] });
    expect(confirmButton()).toBeEnabled();
    await user.click(confirmButton());

    expect(await findMessage(t['import.result.done'])).toBeInTheDocument();
    expect(summaryValue(t['import.result.accountsCreated'])).toBe('1');
    expect(summaryValue(t['import.result.credentialsCreated'])).toBe('1');
    expect(summaryValue(t['import.result.duplicatesSkipped'])).toBe('1');

    const commitCalls = api.callsTo('POST', COMMIT_PATH);
    expect(commitCalls).toHaveLength(1);
    expect(commitCalls[0]?.body).toEqual({ csv: CSV_TEXT });
    // La vista previa y el botón desaparecen: ya no hay nada que reenviar.
    expect(screen.queryByRole('table', { name: t['import.table.caption'] })).toBeNull();
    expect(screen.queryByRole('button', { name: t['import.action.confirm'] })).toBeNull();

    expect(document.body.textContent).not.toContain(PASSWORD);
    expect(document.body.textContent).not.toContain(USERNAME);
    expect(router.state.location.href).not.toContain(PASSWORD);
    expect(router.state.location.href).not.toContain('csv');
    expectNoSecretsStored(queryClient, [PASSWORD, USERNAME, CSV_TEXT]);
  });

  it('shows the translated permission error when the commit is denied (403)', async () => {
    setup({
      [`POST ${PREVIEW_PATH}`]: jsonResponse(previewOf([VALID_ROW])),
      [`POST ${COMMIT_PATH}`]: problem(403, 'AUTHZ.PERMISSION'),
    });
    renderApp(PAGE);
    const { user } = await chooseFile();

    await screen.findByRole('table', { name: t['import.table.caption'] });
    await user.click(confirmButton());

    expect(await findMessage(es.errors['AUTHZ.PERMISSION'])).toBeInTheDocument();
    // Sigue la vista previa: nada se importó.
    expect(screen.getByRole('table', { name: t['import.table.caption'] })).toBeInTheDocument();
    expect(screen.queryByText(t['import.result.done'])).toBeNull();
  });

  it('lists the rejected lines of a 422 and blocks resending the same file', async () => {
    setup({
      [`POST ${PREVIEW_PATH}`]: jsonResponse(previewOf([VALID_ROW])),
      [`POST ${COMMIT_PATH}`]: problem(422, 'VALIDATION.FAILED', {
        errors: [
          { field: 'line.3', code: 'PLATFORM_UNKNOWN' },
          { field: 'line.5', code: 'PASSWORD_REQUIRED' },
          { field: 'unknown.field', code: 'NOT_A_ROW_CODE' },
        ],
      }),
    });
    renderApp(PAGE);
    const { user } = await chooseFile();

    await screen.findByRole('table', { name: t['import.table.caption'] });
    await user.click(confirmButton());

    expect(await findMessage(es.errors['VALIDATION.FAILED'])).toBeInTheDocument();
    expect(
      screen.getByText(
        fill(t['import.rejected.line'], {
          line: 3,
          reason: t['import.rowError.PLATFORM_UNKNOWN'],
        }),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        fill(t['import.rejected.line'], {
          line: 5,
          reason: t['import.rowError.PASSWORD_REQUIRED'],
        }),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/NOT_A_ROW_CODE/)).toBeNull();
    expect(confirmButton()).toBeDisabled();
  });
});

describe('credential import: secrets', () => {
  // SENSIBLE (revisión humana): cancelar descarta la vista previa y el texto; no queda nada que confirmar.
  it('clears everything on Cancel, returns focus to the file input and sends nothing', async () => {
    const api = setup({
      [`POST ${PREVIEW_PATH}`]: jsonResponse(previewOf([VALID_ROW])),
    });
    const { queryClient } = renderApp(PAGE);
    const { user, input } = await chooseFile();

    await screen.findByRole('table', { name: t['import.table.caption'] });
    await user.click(screen.getByRole('button', { name: es.common['actions.cancel'] }));

    expect(screen.queryByRole('table', { name: t['import.table.caption'] })).toBeNull();
    expect(screen.queryByText(t['import.summary.title'])).toBeNull();
    expect(screen.queryByRole('button', { name: t['import.action.confirm'] })).toBeNull();
    await waitFor(() => {
      expect(input).toHaveFocus();
    });
    expect((input as HTMLInputElement).value).toBe('');
    expect(api.callsTo('POST', COMMIT_PATH)).toHaveLength(0);
    expect(document.body.textContent).not.toContain(PASSWORD);
    expectNoSecretsStored(queryClient, [PASSWORD, USERNAME, CSV_TEXT]);
  });

  // SENSIBLE (revisión humana): la contraseña nunca se pinta, ni aunque el servidor la devolviera por error.
  it('never renders a password column or value, even if the response carried one', async () => {
    const leakingRow = { ...VALID_ROW, password: PASSWORD, username: USERNAME };
    setup({
      [`POST ${PREVIEW_PATH}`]: jsonResponse({
        ...previewOf([VALID_ROW]),
        rows: [leakingRow],
      }),
    });
    const { queryClient } = renderApp(PAGE);
    await chooseFile();

    const table = await screen.findByRole('table', { name: t['import.table.caption'] });
    expect(table.textContent).not.toContain(PASSWORD);
    expect(table.textContent).not.toContain(USERNAME);
    expect(document.body.textContent).not.toContain(PASSWORD);
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent.toLowerCase()),
    ).not.toContain('password');
    expectNoSecretsStored(queryClient, [PASSWORD, CSV_TEXT]);
  });

  it('lets the person start over with another file after a result', async () => {
    const api = setup({
      [`POST ${PREVIEW_PATH}`]: jsonResponse(previewOf([VALID_ROW])),
      [`POST ${COMMIT_PATH}`]: jsonResponse(
        { accountsCreated: 1, credentialsCreated: 1, duplicatesSkipped: 0 },
        201,
      ),
    });
    renderApp(PAGE);
    const { user } = await chooseFile();
    await screen.findByRole('table', { name: t['import.table.caption'] });
    await user.click(confirmButton());
    await findMessage(t['import.result.done']);

    await user.click(screen.getByRole('button', { name: t['import.action.another'] }));

    const input = await screen.findByLabelText(t['import.file.label']);
    await waitFor(() => {
      expect(input).toHaveFocus();
    });
    expect(screen.queryByText(t['import.result.done'])).toBeNull();
    expect(api.callsTo('POST', COMMIT_PATH)).toHaveLength(1);
  });
});

describe('credential import: entry point', () => {
  const accountsRoutes = {
    'GET /accounts': jsonResponse({ data: [], page: { nextCursor: null, limit: 25 } }),
    'GET /platforms': jsonResponse({ data: [] }),
  };

  it('is reachable from the accounts screen with account.create and credential.create', async () => {
    const user = userEvent.setup();
    setup(accountsRoutes);
    const { router } = renderApp('/accounts');

    await user.click(await screen.findByRole('link', { name: es.accounts['import.open'] }));

    expect(await screen.findByRole('heading', { name: t['import.title'] })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(PAGE);
  });

  it('hides the link without credential.create', async () => {
    stubApi({
      'GET /me': jsonResponse(meFixture({ permissions: ['account.create'], rank: 1 })),
      ...accountsRoutes,
    });
    renderApp('/accounts');

    await screen.findByRole('button', { name: es.accounts['create.open'] });
    expect(screen.queryByRole('link', { name: es.accounts['import.open'] })).toBeNull();
  });
});
