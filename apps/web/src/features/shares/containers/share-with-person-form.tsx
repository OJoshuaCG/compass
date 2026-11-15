import {
  SHARE_LEVELS,
  type CreateShareRequest,
  type DirectoryUser,
  type Group,
  type ShareLevel,
} from '@iam/contracts';
import { Button, FormField, Input, NativeSelect, RadioGroup, SearchInput, Spinner } from '@iam/ui';
import { useQuery } from '@tanstack/react-query';
import { useId, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { useMe } from '../../../shared/auth';
import { ErrorAlert } from '../../../shared/i18n';
import { useDebouncedCommit } from '../../../shared/lib';
import { fetchManagedGroups, fetchShareCandidates, sharesKeys } from '../api/shares-api';
import {
  buildShareRequest,
  DEFAULT_GRANTEE_TYPE,
  DEFAULT_SHARE_LEVEL,
  type ShareFormError,
  type ShareGranteeType,
} from '../model/share-form';

/** Mismo tiempo de frescura que la búsqueda de personas del directorio. */
const CANDIDATES_STALE_MS = 30_000;

/** Los grupos que gestiona una persona cambian poco, pero se piden frescos al elegir el modo grupo. */
const MANAGED_GROUPS_STALE_MS = 0;

export type ShareWithPersonFormProps = {
  /**
   * Da de alta la compartición en el recurso concreto (una cuenta, una vista de códigos). El
   * formulario no sabe qué se comparte: solo arma y valida el cuerpo común de `CreateShareRequest`.
   */
  createShare: (body: CreateShareRequest) => Promise<{ granteeName: string }>;
  /** Textos que dependen del recurso, ya traducidos: el resto sale del catálogo `shares`. */
  submitLabel: string;
  submitHint: string;
  /** Qué permite cada nivel sobre este recurso: el significado cambia entre cuentas y vistas. */
  levelOptionLabel: (level: ShareLevel) => string;
  onCancel: () => void;
  /** Éxito: recibe el nombre de la persona o del grupo; el padre avisa y recarga. */
  onShared: (granteeName: string) => void;
};

/**
 * Formulario "compartir con una persona o un grupo": en modo persona busca en el directorio; en
 * modo grupo ofrece los grupos que quien comparte gestiona (`GET /groups?managedByMe=true`). Luego
 * elige el nivel y una caducidad opcional. Requiere el catálogo `shares` cargado. El cuerpo que
 * entrega a `createShare` es siempre un `CreateShareRequest`, con `granteeType` `user` o `group`.
 * El servidor decide siempre si el grupo se puede usar; la lista solo evita ofrecer lo que no procede.
 */
export function ShareWithPersonForm({
  createShare,
  submitLabel,
  submitHint,
  levelOptionLabel,
  onCancel,
  onShared,
}: ShareWithPersonFormProps) {
  const { t } = useTranslation(['shares', 'common', 'errors']);
  const currentUserId = useMe()?.user.id;
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useDebouncedCommit(query, setQuery);
  // La persona elegida se guarda completa y aparte de los resultados: la búsqueda filtra la lista
  // y, si la selección se derivara de ella, desaparecería al buscar otro texto. Solo vive en el
  // estado de este formulario y se descarta al cerrar el diálogo.
  const [selectedPerson, setSelectedPerson] = useState<DirectoryUser | undefined>(undefined);
  const [granteeType, setGranteeType] = useState<ShareGranteeType>(DEFAULT_GRANTEE_TYPE);
  const [selectedGroupId, setSelectedGroupId] = useState<string | undefined>(undefined);
  const isGroupMode = granteeType === 'group';
  const selectedId = isGroupMode ? selectedGroupId : selectedPerson?.id;
  const hasSelection = selectedId !== undefined;
  const searchInputRef = useRef<HTMLInputElement>(null);
  const submitHintId = useId();
  const [level, setLevel] = useState<ShareLevel>(DEFAULT_SHARE_LEVEL);
  const [expiresAtLocal, setExpiresAtLocal] = useState('');
  const [formError, setFormError] = useState<ShareFormError | undefined>(undefined);

  const action = useAsyncAction((body: CreateShareRequest) => createShare(body));
  const cooldown = useRateLimitCooldown(action.error);

  const candidates = useQuery({
    queryKey: sharesKeys.candidates(query),
    queryFn: ({ signal }) => fetchShareCandidates(query, signal),
    staleTime: CANDIDATES_STALE_MS,
    enabled: !isGroupMode,
  });
  // Solo se pide en modo grupo: quien comparte con personas no paga una consulta que no usa.
  const managedGroups = useQuery({
    queryKey: sharesKeys.managedGroups(),
    queryFn: ({ signal }) => fetchManagedGroups(signal),
    staleTime: MANAGED_GROUPS_STALE_MS,
    enabled: isGroupMode,
  });
  const groups: Group[] = managedGroups.data ?? [];

  // Compartirse a uno mismo lo rechaza el servidor (SHARE.GRANTEE_INVALID); aquí solo se evita
  // ofrecer esa opción.
  const eligible: DirectoryUser[] = (candidates.data?.data ?? []).filter(
    (candidate) => candidate.id !== currentUserId,
  );

  async function submit() {
    const built = buildShareRequest(
      { granteeType, granteeId: selectedId, level, expiresAtLocal },
      new Date(),
    );
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
      <RadioGroup
        legend={t('share.granteeTypeLegend', { ns: 'shares' })}
        options={[
          { value: 'user', label: t('granteeType.user', { ns: 'shares' }) },
          { value: 'group', label: t('granteeType.group', { ns: 'shares' }) },
        ]}
        value={granteeType}
        onValueChange={(next) => {
          setGranteeType(next as ShareGranteeType);
          setFormError(undefined);
        }}
      />
      {!isGroupMode ? (
        <>
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
            <p className="text-sm text-text-secondary">
              {t('share.searchEmpty', { ns: 'shares' })}
            </p>
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
        </>
      ) : (
        <>
          {managedGroups.isError ? (
            <ErrorAlert
              error={managedGroups.error}
              onRetry={() => {
                void managedGroups.refetch();
              }}
            />
          ) : null}
          <div
            role="status"
            className="flex items-center gap-2 text-sm text-text-secondary empty:hidden"
          >
            {managedGroups.isPending ? (
              <>
                <Spinner />
                {t('share.groupsLoading', { ns: 'shares' })}
              </>
            ) : null}
          </div>
          {managedGroups.data !== undefined && groups.length === 0 ? (
            <p className="text-sm text-text-secondary">
              {t('share.groupsEmpty', { ns: 'shares' })}
            </p>
          ) : null}
          {groups.length > 0 ? (
            <RadioGroup
              legend={t('share.groupLegend', { ns: 'shares' })}
              className="max-h-64 overflow-y-auto"
              options={groups.map((group) => ({
                value: group.id,
                label: group.name,
                ...(group.description === null ? {} : { description: group.description }),
              }))}
              value={selectedGroupId}
              onValueChange={(groupId) => {
                setSelectedGroupId(groupId);
                setFormError(undefined);
              }}
            />
          ) : null}
        </>
      )}
      {formError === 'granteeRequired' ? (
        <p role="alert" className="text-sm text-danger">
          {t(isGroupMode ? 'share.groupRequired' : 'share.granteeRequired', { ns: 'shares' })}
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
                {levelOptionLabel(shareLevel)}
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
      {!hasSelection ? (
        // Motivo visible del botón deshabilitado: un botón deshabilitado no recibe foco y el
        // texto, enlazado con `aria-describedby`, deja la razón disponible para lectores de pantalla.
        <p id={submitHintId} className="text-sm text-text-secondary">
          {isGroupMode ? t('share.submitHintGroup', { ns: 'shares' }) : submitHint}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={onCancel}>
          {t('actions.cancel', { ns: 'common' })}
        </Button>
        <Button
          type="submit"
          loading={action.pending}
          disabled={!hasSelection || cooldown.secondsLeft > 0}
          aria-describedby={!hasSelection ? submitHintId : undefined}
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
