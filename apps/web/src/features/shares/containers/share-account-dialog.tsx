import {
  SHARE_LEVELS,
  type CreateShareRequest,
  type DirectoryUser,
  type ShareLevel,
} from '@iam/contracts';
import {
  Button,
  Dialog,
  FormField,
  Input,
  NativeSelect,
  RadioGroup,
  SearchInput,
  Spinner,
} from '@iam/ui';
import { useQuery } from '@tanstack/react-query';
import { useId, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { useMe } from '../../../shared/auth';
import { ErrorAlert } from '../../../shared/i18n';
import { useDebouncedCommit } from '../../../shared/lib';
import { createShare, fetchShareCandidates, sharesKeys } from '../api/shares-api';
import { buildShareRequest, DEFAULT_SHARE_LEVEL, type ShareFormError } from '../model/share-form';

/** Mismo tiempo de frescura que la búsqueda de personas del directorio. */
const CANDIDATES_STALE_MS = 30_000;

type ShareAccountFormProps = {
  accountId: string;
  onCancel: () => void;
  /** Éxito: recibe el nombre de la persona; el padre avisa y recarga. */
  onShared: (granteeName: string) => void;
};

function ShareAccountForm({ accountId, onCancel, onShared }: ShareAccountFormProps) {
  const { t } = useTranslation(['shares', 'common', 'errors']);
  const currentUserId = useMe()?.user.id;
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useDebouncedCommit(query, setQuery);
  // La persona elegida se guarda completa y aparte de los resultados: la búsqueda filtra la lista
  // y, si la selección se derivara de ella, desaparecería al buscar otro texto. Solo vive en el
  // estado de este formulario y se descarta al cerrar el diálogo.
  const [selectedPerson, setSelectedPerson] = useState<DirectoryUser | undefined>(undefined);
  const selectedId = selectedPerson?.id;
  const searchInputRef = useRef<HTMLInputElement>(null);
  const submitHintId = useId();
  const [level, setLevel] = useState<ShareLevel>(DEFAULT_SHARE_LEVEL);
  const [expiresAtLocal, setExpiresAtLocal] = useState('');
  const [formError, setFormError] = useState<ShareFormError | undefined>(undefined);

  const action = useAsyncAction((body: CreateShareRequest) => createShare(accountId, body));
  const cooldown = useRateLimitCooldown(action.error);

  const candidates = useQuery({
    queryKey: sharesKeys.candidates(query),
    queryFn: ({ signal }) => fetchShareCandidates(query, signal),
    staleTime: CANDIDATES_STALE_MS,
  });

  // Compartirse a uno mismo lo rechaza el servidor (SHARE.GRANTEE_INVALID); aquí solo se evita
  // ofrecer esa opción.
  const eligible: DirectoryUser[] = (candidates.data?.data ?? []).filter(
    (candidate) => candidate.id !== currentUserId,
  );

  async function submit() {
    const built = buildShareRequest({ granteeId: selectedId, level, expiresAtLocal }, new Date());
    if (!built.ok) {
      setFormError(built.error);
      return;
    }
    setFormError(undefined);
    const result = await action.run(built.request);
    if (result.ok) {
      onShared(result.value.granteeName);
    }
  }

  function expiryErrorMessage(): string | undefined {
    if (formError === 'expiryPast') return t('share.expiryPast', { ns: 'shares' });
    if (formError === 'expiryInvalid') return t('SHARE.EXPIRY_INVALID', { ns: 'errors' });
    return undefined;
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-4"
    >
      <p className="text-sm text-text-secondary">{t('share.groupsNote', { ns: 'shares' })}</p>
      {action.error !== undefined ? (
        <ErrorAlert error={action.error} secondsLeft={cooldown.secondsLeft} />
      ) : null}
      <SearchInput
        label={t('share.search', { ns: 'shares' })}
        clearLabel={t('search.clear', { ns: 'common' })}
        placeholder={t('search.placeholder', { ns: 'common' })}
        value={draft}
        onValueChange={setDraft}
        ref={searchInputRef}
      />
      {candidates.isError ? (
        <ErrorAlert
          error={candidates.error}
          onRetry={() => {
            void candidates.refetch();
          }}
        />
      ) : null}
      {/* Región siempre montada: un `role="status"` que aparece ya con su texto no se anuncia.
          El icono es decorativo para no duplicar el anuncio. */}
      <div
        role="status"
        className="flex items-center gap-2 text-sm text-text-secondary empty:hidden"
      >
        {candidates.isPending ? (
          <>
            <Spinner />
            {t('share.searchLoading', { ns: 'shares' })}
          </>
        ) : null}
      </div>
      {candidates.data !== undefined && eligible.length === 0 ? (
        <p className="text-sm text-text-secondary">{t('share.searchEmpty', { ns: 'shares' })}</p>
      ) : null}
      {eligible.length > 0 ? (
        <RadioGroup
          legend={t('share.legend', { ns: 'shares' })}
          className="max-h-64 overflow-y-auto"
          options={eligible.map((candidate) => ({
            value: candidate.id,
            label: candidate.displayName,
            description: candidate.email,
          }))}
          value={selectedId}
          onValueChange={(personId) => {
            setSelectedPerson(eligible.find((candidate) => candidate.id === personId));
            setFormError(undefined);
          }}
        />
      ) : null}
      {selectedPerson !== undefined ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-strong px-3 py-2">
          <p className="min-w-0 break-words text-sm text-text">
            {t('share.selected', {
              ns: 'shares',
              name: selectedPerson.displayName,
              email: selectedPerson.email,
            })}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setSelectedPerson(undefined);
              searchInputRef.current?.focus();
            }}
          >
            {t('share.clearSelection', { ns: 'shares' })}
          </Button>
        </div>
      ) : null}
      {formError === 'granteeRequired' ? (
        <p role="alert" className="text-sm text-danger">
          {t('share.granteeRequired', { ns: 'shares' })}
        </p>
      ) : null}
      <FormField label={t('share.level', { ns: 'shares' })} required>
        {(field) => (
          <NativeSelect
            {...field}
            value={level}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => {
              setLevel(event.target.value as ShareLevel);
            }}
          >
            {SHARE_LEVELS.map((shareLevel) => (
              <option key={shareLevel} value={shareLevel}>
                {t(`levelOption.${shareLevel}`, { ns: 'shares' })}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField
        label={t('share.expiresAt', { ns: 'shares' })}
        help={t('share.expiresAtHelp', { ns: 'shares' })}
        error={expiryErrorMessage()}
      >
        {(field) => (
          <Input
            {...field}
            type="datetime-local"
            value={expiresAtLocal}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              setExpiresAtLocal(event.target.value);
              setFormError(undefined);
            }}
            invalid={field['aria-invalid'] === true}
          />
        )}
      </FormField>
      {selectedPerson === undefined ? (
        // Motivo visible del botón deshabilitado: un botón deshabilitado no recibe foco y el
        // texto, enlazado con `aria-describedby`, deja la razón disponible para lectores de pantalla.
        <p id={submitHintId} className="text-sm text-text-secondary">
          {t('share.submitHint', { ns: 'shares' })}
        </p>
      ) : null}
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onCancel}>
          {t('actions.cancel', { ns: 'common' })}
        </Button>
        <Button
          type="submit"
          loading={action.pending}
          disabled={selectedPerson === undefined || cooldown.secondsLeft > 0}
          aria-describedby={selectedPerson === undefined ? submitHintId : undefined}
        >
          {t('share.submit', { ns: 'shares' })}
        </Button>
      </div>
    </form>
  );
}

export type ShareAccountDialogProps = {
  accountId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Éxito: recibe el nombre de la persona; el padre avisa y recarga. */
  onShared: (granteeName: string) => void;
};

/**
 * Diálogo "Compartir": busca una persona en el directorio, elige el nivel y una caducidad
 * opcional. Solo comparte con personas: aún no existe un listado de grupos en la API.
 */
export function ShareAccountDialog({
  accountId,
  open,
  onOpenChange,
  onShared,
}: ShareAccountDialogProps) {
  const { t } = useTranslation(['shares', 'common']);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('share.title', { ns: 'shares' })}
      description={t('share.description', { ns: 'shares' })}
      closeLabel={t('dialog.close', { ns: 'common' })}
    >
      {/* El formulario se monta solo con el diálogo abierto: al cerrar se descarta lo escrito. */}
      <ShareAccountForm
        accountId={accountId}
        onCancel={() => {
          onOpenChange(false);
        }}
        onShared={onShared}
      />
    </Dialog>
  );
}
