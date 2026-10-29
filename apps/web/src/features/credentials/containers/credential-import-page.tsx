import type { CredentialImportPreview, CredentialImportResult } from '@iam/contracts';
import { DEFAULT_PAGE_LIMIT } from '@iam/contracts';
import {
  Alert,
  Button,
  buttonVariants,
  FormField,
  Input,
  PageHeader,
  Spinner,
  type PageLimit,
} from '@iam/ui';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { useErrorMessage } from '../../../shared/i18n';
import { useLazyCatalog } from '../../../shared/i18n/use-lazy-catalog';
import { commitCredentialImport, previewCredentialImport } from '../api/credential-import-api';
import {
  canConfirmImport,
  checkCsvFile,
  CREDENTIAL_IMPORT_FILE_EXTENSION,
  parseRowErrorLines,
  sliceRows,
  type CsvFileProblem,
} from '../model/credential-import-model';
import { CredentialImportSummary } from '../ui/credential-import-summary';
import { CredentialImportTable } from '../ui/credential-import-table';

type FileProblem = CsvFileProblem | 'read_failed';

const BACK_LINK_CLASS =
  'inline-flex min-h-6 items-center text-sm text-accent underline underline-offset-4';

/**
 * Container de `/credentials/import`: elegir un `.csv`, previsualizarlo, confirmar y ver los
 * conteos. El texto del CSV (lleva contraseñas) vive SOLO en una referencia de este componente:
 * no entra a un estado que se pinte, a la caché de Query, a la URL ni al almacenamiento, y se
 * descarta al cancelar, al terminar, ante un error del servidor y al desmontar. La vista previa
 * y el resultado solo contienen lo que el contrato permite (sin usuario ni contraseña).
 */
export function CredentialImportPage() {
  const catalogReady = useLazyCatalog('credentials');
  const { t } = useTranslation(['credentials', 'common', 'errors']);
  const errorMessage = useErrorMessage();
  const csvRef = useRef<string | null>(null);
  // Cada elección o cancelación abre una "generación": una respuesta tardía de una anterior se ignora.
  const generationRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [focusRequests, setFocusRequests] = useState(0);
  const [reading, setReading] = useState(false);
  const [fileProblem, setFileProblem] = useState<FileProblem | null>(null);
  const [preview, setPreview] = useState<CredentialImportPreview | null>(null);
  const [result, setResult] = useState<CredentialImportResult | null>(null);
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState<PageLimit>(DEFAULT_PAGE_LIMIT);
  // Sin `useMutation`: su caché conservaría el CSV en `variables` (docs/frontend.md §9).
  const previewAction = useAsyncAction(previewCredentialImport);
  const commitAction = useAsyncAction(commitCredentialImport);
  const cooldown = useRateLimitCooldown(commitAction.error);
  const resetPreview = previewAction.reset;
  const resetCommit = commitAction.reset;

  useEffect(() => {
    // Al desmontar se suelta el texto y se invalida cualquier lectura o petición en vuelo.
    return () => {
      generationRef.current += 1;
      csvRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (focusRequests > 0) fileInputRef.current?.focus();
  }, [focusRequests]);

  if (!catalogReady) return <Spinner label={t('state.loading', { ns: 'common' })} />;

  function discard() {
    generationRef.current += 1;
    csvRef.current = null;
    resetPreview();
    resetCommit();
    setReading(false);
    setFileProblem(null);
    setPreview(null);
    setResult(null);
    setOffset(0);
  }

  function handleCancel() {
    discard();
    setFocusRequests((requests) => requests + 1);
  }

  async function handleFileChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Se vacía el control para poder elegir el mismo archivo otra vez y no retener su referencia.
    event.target.value = '';
    if (file === undefined) return;
    discard();
    const generation = generationRef.current;

    const problem = checkCsvFile(file);
    if (problem !== null) {
      setFileProblem(problem);
      return;
    }

    setReading(true);
    let csvText: string;
    try {
      csvText = await file.text();
    } catch {
      if (generation !== generationRef.current) return;
      setReading(false);
      setFileProblem('read_failed');
      return;
    }
    if (generation !== generationRef.current) return;
    csvRef.current = csvText;

    const outcome = await previewAction.run(csvText);
    if (generation !== generationRef.current) return;
    setReading(false);
    if (outcome.ok) {
      setPreview(outcome.value);
    } else {
      // Sin vista previa no hay nada que confirmar: el texto no se conserva.
      csvRef.current = null;
    }
  }

  async function handleConfirm() {
    const csvText = csvRef.current;
    if (csvText === null || preview === null || !canConfirmImport(preview)) return;
    const generation = generationRef.current;
    const outcome = await commitAction.run(csvText);
    if (generation !== generationRef.current) return;
    if (outcome.ok) {
      csvRef.current = null;
      setPreview(null);
      setResult(outcome.value);
    } else if (outcome.error instanceof ApiError && outcome.error.status === 422) {
      // Tras un rechazo por filas el mismo archivo no se puede reenviar (la confirmación queda bloqueada),
      // así que el texto, que lleva contraseñas, no se conserva más tiempo del necesario.
      csvRef.current = null;
    }
  }

  function fileProblemMessage(problem: FileProblem): string {
    switch (problem) {
      case 'not_csv':
        return t('import.file.notCsv', { ns: 'credentials' });
      case 'empty':
        return t('CREDENTIAL_IMPORT.EMPTY', { ns: 'errors' });
      case 'too_large':
        return t('CREDENTIAL_IMPORT.FILE_TOO_LARGE', { ns: 'errors' });
      case 'read_failed':
        return t('import.file.readFailed', { ns: 'credentials' });
    }
  }

  const header = (
    <>
      <Link to="/accounts" className={BACK_LINK_CLASS}>
        {t('back', { ns: 'credentials' })}
      </Link>
      <PageHeader
        title={t('import.title', { ns: 'credentials' })}
        description={t('import.description', { ns: 'credentials' })}
      />
    </>
  );

  if (result !== null) {
    return (
      <>
        {header}
        <Alert tone="success">{t('import.result.done', { ns: 'credentials' })}</Alert>
        <CredentialImportSummary
          title={t('import.result.title', { ns: 'credentials' })}
          items={[
            {
              id: 'accounts',
              label: t('import.result.accountsCreated', { ns: 'credentials' }),
              value: result.accountsCreated,
            },
            {
              id: 'credentials',
              label: t('import.result.credentialsCreated', { ns: 'credentials' }),
              value: result.credentialsCreated,
            },
            {
              id: 'duplicates',
              label: t('import.result.duplicatesSkipped', { ns: 'credentials' }),
              value: result.duplicatesSkipped,
            },
          ]}
        />
        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            onClick={() => {
              discard();
              setFocusRequests((requests) => requests + 1);
            }}
          >
            {t('import.action.another', { ns: 'credentials' })}
          </Button>
          <Link to="/accounts" className={buttonVariants({ variant: 'secondary' })}>
            {t('import.action.accounts', { ns: 'credentials' })}
          </Link>
        </div>
      </>
    );
  }

  const busy = reading || previewAction.pending;
  const commitError = commitAction.error;
  const rejectedLines =
    commitError instanceof ApiError && commitError.status === 422
      ? parseRowErrorLines(commitError.fieldErrors)
      : [];
  // Tras un 422 el mismo archivo se rechazaría igual: hay que corregirlo y elegirlo de nuevo.
  const commitRejected = commitError instanceof ApiError && commitError.status === 422;

  return (
    <>
      {header}
      <Alert tone="info">{t('import.privacy', { ns: 'credentials' })}</Alert>
      <FormField
        label={t('import.file.label', { ns: 'credentials' })}
        help={t('import.file.help', { ns: 'credentials' })}
        error={fileProblem === null ? undefined : fileProblemMessage(fileProblem)}
      >
        {(field) => (
          <Input
            {...field}
            ref={fileInputRef}
            type="file"
            accept={`${CREDENTIAL_IMPORT_FILE_EXTENSION},text/csv`}
            disabled={busy || commitAction.pending}
            invalid={field['aria-invalid'] === true}
            onChange={(event) => {
              void handleFileChosen(event);
            }}
          />
        )}
      </FormField>
      {busy ? <Spinner label={t('import.working', { ns: 'credentials' })} /> : null}
      {previewAction.error !== undefined ? (
        <Alert tone="danger">{errorMessage(previewAction.error)}</Alert>
      ) : null}
      {preview !== null ? (
        <>
          {preview.invalidRows > 0 ? (
            <Alert tone="warning">{t('import.blocked.invalid', { ns: 'credentials' })}</Alert>
          ) : preview.validRows === 0 ? (
            <Alert tone="warning">{t('import.blocked.nothing', { ns: 'credentials' })}</Alert>
          ) : (
            <Alert tone="info">{t('import.ready', { ns: 'credentials' })}</Alert>
          )}
          <CredentialImportSummary
            title={t('import.summary.title', { ns: 'credentials' })}
            items={[
              {
                id: 'total',
                label: t('import.summary.total', { ns: 'credentials' }),
                value: preview.totalRows,
              },
              {
                id: 'valid',
                label: t('import.summary.valid', { ns: 'credentials' }),
                value: preview.validRows,
              },
              {
                id: 'invalid',
                label: t('import.summary.invalid', { ns: 'credentials' }),
                value: preview.invalidRows,
              },
              {
                id: 'duplicate',
                label: t('import.summary.duplicate', { ns: 'credentials' }),
                value: preview.duplicateRows,
              },
            ]}
          />
          <CredentialImportTable
            rows={sliceRows(preview.rows, offset, limit)}
            limit={limit}
            onLimitChange={(next) => {
              setLimit(next);
              setOffset(0);
            }}
            total={preview.rows.length}
            offset={offset}
            onPrevious={() => {
              setOffset((current) => Math.max(0, current - limit));
            }}
            onNext={() => {
              setOffset((current) => current + limit);
            }}
          />
          {commitError !== undefined ? (
            <Alert tone="danger">
              <p>
                {errorMessage(commitError)}
                {cooldown.secondsLeft > 0
                  ? ` ${t('retryIn', { ns: 'errors', seconds: cooldown.secondsLeft })}`
                  : null}
              </p>
              {rejectedLines.length > 0 ? (
                <ul className="mt-2 list-disc ps-4">
                  {rejectedLines.map((rejected) => (
                    <li key={`${String(rejected.line)}-${rejected.code}`}>
                      {t('import.rejected.line', {
                        ns: 'credentials',
                        line: rejected.line,
                        reason: t(`import.rowError.${rejected.code}`, { ns: 'credentials' }),
                      })}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Alert>
          ) : null}
          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="secondary" disabled={commitAction.pending} onClick={handleCancel}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
            <Button
              loading={commitAction.pending}
              disabled={!canConfirmImport(preview) || commitRejected || cooldown.secondsLeft > 0}
              onClick={() => {
                void handleConfirm();
              }}
            >
              {t('import.action.confirm', { ns: 'credentials' })}
            </Button>
          </div>
        </>
      ) : null}
    </>
  );
}
