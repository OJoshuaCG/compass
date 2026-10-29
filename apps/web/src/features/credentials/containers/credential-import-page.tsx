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
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';

import {
  ApiError,
  NETWORK_ERROR_CODE,
  useAsyncAction,
  useRateLimitCooldown,
} from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
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

/**
 * Un fallo transitorio (red, 5xx o 429) se puede reintentar con el mismo texto; cualquier otro
 * (403, 422...) no cambiaría con reenviar lo mismo y exige elegir el archivo de nuevo.
 */
function isRetryableError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return error.status === 429 || error.status >= 500 || error.code === NETWORK_ERROR_CODE;
}

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
  const csvRef = useRef<string | null>(null);
  // Cada elección o cancelación abre una "generación": una respuesta tardía de una anterior se ignora.
  const generationRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
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
  const previewCooldown = useRateLimitCooldown(previewAction.error);
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

  const hasResult = result !== null;
  useEffect(() => {
    // La vista previa desaparece al importar y el foco se perdería: pasa al encabezado del resultado.
    if (hasResult) resultHeadingRef.current?.focus();
  }, [hasResult]);

  // Las filas no válidas van primero para encontrarlas sin recorrer páginas; el resto conserva el orden del archivo.
  const orderedRows = useMemo(() => {
    if (preview === null) return [];
    const invalidRows = preview.rows.filter((row) => row.status === 'invalid');
    const otherRows = preview.rows.filter((row) => row.status !== 'invalid');
    return [...invalidRows, ...otherRows];
  }, [preview]);

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
    await runPreview(csvText, generation);
  }

  async function runPreview(csvText: string, generation: number) {
    const outcome = await previewAction.run(csvText);
    if (generation !== generationRef.current) return;
    setReading(false);
    if (outcome.ok) {
      setPreview(outcome.value);
    } else if (!isRetryableError(outcome.error)) {
      // Sin vista previa no hay nada que confirmar; solo un fallo transitorio conserva el texto para reintentar.
      csvRef.current = null;
    }
  }

  function handleRetryPreview() {
    const csvText = csvRef.current;
    if (csvText === null) return;
    void runPreview(csvText, generationRef.current);
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

  // Región siempre montada: un `role="status"` que aparece ya con su texto no se anuncia. El mensaje es
  // fijo; nunca incluye contenido del archivo.
  const statusRegion = (
    <p role="status" className="text-sm text-success empty:hidden">
      {result === null ? '' : t('import.result.done', { ns: 'credentials' })}
    </p>
  );

  if (result !== null) {
    return (
      <>
        {header}
        {statusRegion}
        <CredentialImportSummary
          title={t('import.result.title', { ns: 'credentials' })}
          headingRef={resultHeadingRef}
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

  const canRetryPreview =
    isRetryableError(previewAction.error) && previewCooldown.secondsLeft === 0;
  const canRetryCommit = isRetryableError(commitError) && cooldown.secondsLeft === 0;
  const retryCommit = () => {
    void handleConfirm();
  };

  return (
    <>
      {header}
      {statusRegion}
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
        <div className="flex flex-col gap-2">
          <ErrorAlert
            error={previewAction.error}
            secondsLeft={previewCooldown.secondsLeft}
            {...(canRetryPreview ? { onRetry: handleRetryPreview } : {})}
          />
          {isRetryableError(previewAction.error) ? null : (
            <p className="text-sm text-text-secondary">
              {t('import.error.chooseAgain', { ns: 'credentials' })}
            </p>
          )}
        </div>
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
          {preview.invalidRows > 0 ? (
            <p className="text-sm text-text-secondary">
              {t('import.table.invalidFirst', { ns: 'credentials' })}
            </p>
          ) : null}
          <CredentialImportTable
            rows={sliceRows(orderedRows, offset, limit)}
            limit={limit}
            onLimitChange={(next) => {
              setLimit(next);
              setOffset(0);
            }}
            total={orderedRows.length}
            offset={offset}
            onPrevious={() => {
              setOffset((current) => Math.max(0, current - limit));
            }}
            onNext={() => {
              setOffset((current) => current + limit);
            }}
          />
          {commitError !== undefined ? (
            <div className="flex flex-col gap-2">
              <ErrorAlert
                error={commitError}
                secondsLeft={cooldown.secondsLeft}
                {...(canRetryCommit ? { onRetry: retryCommit } : {})}
              />
              {rejectedLines.length > 0 ? (
                <ul className="list-disc ps-4 text-sm">
                  {rejectedLines.map((rejected, index) => (
                    // El índice evita claves repetidas si una línea trae el mismo código más de una vez.
                    <li key={`${String(rejected.line)}-${rejected.code}-${String(index)}`}>
                      {t('import.rejected.line', {
                        ns: 'credentials',
                        line: rejected.line,
                        reason: t(`import.rowError.${rejected.code}`, { ns: 'credentials' }),
                      })}
                    </li>
                  ))}
                </ul>
              ) : null}
              {commitRejected ? (
                <p className="text-sm text-text-secondary">
                  {t('import.error.chooseAgain', { ns: 'credentials' })}
                </p>
              ) : null}
            </div>
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
