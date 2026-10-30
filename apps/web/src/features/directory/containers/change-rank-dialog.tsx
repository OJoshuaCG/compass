import {
  changeRankRequestSchema,
  ErrorCode,
  RANK_CHANGE_REASON_MAX_LENGTH,
  type ChangeRankRequest,
  type ManagedUser,
  type Rank,
  type RankChangeResponse,
} from '@iam/contracts';
import { Alert, Button, Dialog, FormField, Input, NativeSelect } from '@iam/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { ApiError, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert, useValidationMessage } from '../../../shared/i18n';
import { useLazyCatalog } from '../../../shared/i18n/use-lazy-catalog';
import { formatDateTime } from '../../../shared/lib';
import { teamApi } from '../api/team-api';
import { assignableRanks, isRankPromotion } from '../model/team-actions';

export type ChangeRankDialogProps = {
  person: ManagedUser;
  actorRank: Rank;
  onClose: () => void;
  onDone: (message: string) => void;
};

/** Resultado ya confirmado por el servidor, con el aviso que se mostrará al cerrar el diálogo. */
type ConfirmedChange = { response: RankChangeResponse; toastMessage: string };

type ChangeRankFormProps = ChangeRankDialogProps & {
  onConfirmed: (change: ConfirmedChange) => void;
};

function ChangeRankForm({ person, actorRank, onClose, onConfirmed }: ChangeRankFormProps) {
  const { t } = useTranslation(['directory', 'common', 'errors']);
  const validationMessage = useValidationMessage();
  // Si no hubiera opciones (la acción ya se oculta antes) se ofrecen todas: decide el servidor.
  const assignable = assignableRanks(actorRank, person.rank);
  const options = assignable.length > 0 ? assignable : ([1, 2, 3] as const);
  // La reautenticación la gestiona el cliente HTTP: abre su diálogo y reintenta UNA vez.
  const action = useAsyncAction((request: ChangeRankRequest) =>
    teamApi.changeRank(person.id, request.rank, request.reason),
  );
  const cooldown = useRateLimitCooldown(action.error);
  const {
    register,
    handleSubmit,
    control,
    setError,
    setFocus,
    formState: { errors },
  } = useForm<ChangeRankRequest>({
    resolver: zodResolver(changeRankRequestSchema),
    // Por defecto, el rango de menor autoridad: el privilegio mínimo es la opción segura.
    defaultValues: { rank: options.at(-1) ?? 3, reason: '' },
  });

  const chosenRank = useWatch({ control, name: 'rank' });
  const isPromotion = isRankPromotion(person.rank, chosenRank);
  const isDemotion = chosenRank > person.rank;

  const apiError = action.error instanceof ApiError ? action.error : undefined;
  const serverRequiresReason = apiError?.code === ErrorCode.USER_RANK_REASON_REQUIRED;

  // Tras un error del servidor el botón de envío quedó en carga y el foco pudo perderse. Si el motivo
  // faltó se devuelve al campo; el aviso de error ya se anuncia solo (role="alert").
  useEffect(() => {
    if (serverRequiresReason) setFocus('reason');
  }, [serverRequiresReason, setFocus]);

  async function submit({ rank, reason }: ChangeRankRequest) {
    const trimmedReason = (reason ?? '').trim();
    if (isRankPromotion(person.rank, rank) && trimmedReason === '') {
      setError('reason', { type: 'required' });
      setFocus('reason');
      return;
    }
    const request: ChangeRankRequest =
      trimmedReason === '' ? { rank } : { rank, reason: trimmedReason };
    const result = await action.run(request);
    if (result.ok) {
      onConfirmed({
        response: result.value,
        toastMessage: t('team.toast.rankChanged', {
          ns: 'directory',
          name: person.displayName,
          rank: t(`rank.${String(rank)}`, { ns: 'common' }),
        }),
      });
    }
  }

  // Falta el motivo (lo detectó el cliente o el servidor): mismo texto en ambos casos.
  const reasonIsMissing = errors.reason?.type === 'required' || serverRequiresReason;
  const reasonFieldError = reasonIsMissing
    ? t('USER.RANK_REASON_REQUIRED', { ns: 'errors' })
    : validationMessage(errors.reason, { field: 'reason' });

  return (
    <form
      noValidate
      onSubmit={(event) => {
        void handleSubmit(submit)(event);
      }}
      className="flex flex-col gap-4"
    >
      {action.error !== undefined ? (
        <ErrorAlert error={action.error} secondsLeft={cooldown.secondsLeft} />
      ) : null}
      <FormField
        label={t('rank.label', { ns: 'directory' })}
        required
        error={validationMessage(errors.rank, { field: 'rank' })}
      >
        {(field) => (
          <NativeSelect
            {...field}
            {...register('rank', { valueAsNumber: true })}
            invalid={field['aria-invalid'] === true}
          >
            {options.map((rank) => (
              <option key={rank} value={rank}>
                {t(`rank.${String(rank)}`, { ns: 'common' })}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>
      {isDemotion ? (
        <Alert tone="warning">
          {t('rank.demoteWarning', { ns: 'directory', name: person.displayName })}
        </Alert>
      ) : null}
      <FormField
        label={t('rank.reason.label', { ns: 'directory' })}
        required={isPromotion}
        help={t(isPromotion ? 'rank.reason.helpRequired' : 'rank.reason.helpOptional', {
          ns: 'directory',
        })}
        error={reasonFieldError}
      >
        {(field) => (
          <Input
            {...field}
            {...register('reason')}
            maxLength={RANK_CHANGE_REASON_MAX_LENGTH}
            autoComplete="off"
            invalid={field['aria-invalid'] === true}
          />
        )}
      </FormField>
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose}>
          {t('actions.cancel', { ns: 'common' })}
        </Button>
        <Button type="submit" loading={action.pending} disabled={cooldown.secondsLeft > 0}>
          {t('rank.submit', { ns: 'directory' })}
        </Button>
      </div>
    </form>
  );
}

type ChangeRankResultProps = {
  person: ManagedUser;
  change: ConfirmedChange;
  onAcknowledge: () => void;
};

/**
 * Resultado del cambio de rango: roles retirados, plantilla asignada y comparticiones que la persona
 * otorgó y que nadie revocó (hay que revisarlas a mano). Solo ids: el rango nunca concede ver cuentas.
 */
function ChangeRankResult({ person, change, onAcknowledge }: ChangeRankResultProps) {
  const { t, i18n } = useTranslation(['directory', 'common', 'shares']);
  const { removedRoles, assignedRole, sharedAccounts, sharedAccountCount } = change.response;
  // El diálogo no tiene otro control que reciba el foco al desmontarse el formulario: se lleva aquí.
  const headingRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <p ref={headingRef} tabIndex={-1} role="status" className="text-sm font-medium text-text">
        {change.toastMessage}
      </p>
      <section className="flex flex-col gap-1">
        <h3 className="text-sm font-medium text-text">
          {t('rank.result.removedRoles', { ns: 'directory' })}
        </h3>
        {removedRoles.length === 0 ? (
          <p className="text-sm text-text-secondary">
            {t('rank.result.noRemovedRoles', { ns: 'directory' })}
          </p>
        ) : (
          <ul className="list-disc ps-5 text-sm text-text-secondary">
            {removedRoles.map((role) => (
              <li key={role.id}>{role.name}</li>
            ))}
          </ul>
        )}
      </section>
      {assignedRole !== null ? (
        <p className="text-sm text-text-secondary">
          {t('rank.result.assignedRole', { ns: 'directory', role: assignedRole.name })}
        </p>
      ) : null}
      {sharedAccountCount > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-text">
            {t('rank.result.shares.title', { ns: 'directory', count: sharedAccountCount })}
          </h3>
          <Alert tone="warning">
            {t('rank.result.shares.description', { ns: 'directory', name: person.displayName })}
          </Alert>
          <ul className="list-disc ps-5 text-sm break-all text-text-secondary">
            {sharedAccounts.map((share) => (
              <li key={share.shareId}>
                {t('rank.result.shares.item', {
                  ns: 'directory',
                  accountId: share.accountId,
                  grantee: t(`granteeType.${share.granteeType}`, { ns: 'shares' }),
                  granteeId: share.granteeId,
                  level: t(`level.${share.level}`, { ns: 'shares' }),
                  expires:
                    share.expiresAt === null
                      ? t('expires.never', { ns: 'shares' })
                      : formatDateTime(share.expiresAt, i18n.language),
                })}
              </li>
            ))}
          </ul>
          {sharedAccountCount > sharedAccounts.length ? (
            <p className="text-sm text-text-secondary">
              {t('rank.result.shares.truncated', {
                ns: 'directory',
                shown: sharedAccounts.length,
                total: sharedAccountCount,
              })}
            </p>
          ) : null}
        </section>
      ) : null}
      <div className="flex justify-end">
        <Button onClick={onAcknowledge}>{t('rank.result.close', { ns: 'directory' })}</Button>
      </div>
    </div>
  );
}

/**
 * Diálogo "Cambiar rango": solo rangos con menos autoridad que el actor y distintos del actual. Pide
 * motivo al subir (opcional al bajar), advierte antes de bajar y, ya confirmado, muestra qué se retiró y
 * qué comparticiones hay que revisar. Cerrarlo en esa fase equivale a entender: refresca la lista.
 */
export function ChangeRankDialog(props: ChangeRankDialogProps) {
  const { t } = useTranslation(['directory', 'common']);
  const [confirmed, setConfirmed] = useState<ConfirmedChange | null>(null);
  // `shares` es un catálogo de descarga diferida que esta pantalla no carga: el resultado nombra el
  // tipo de destinatario, el nivel y la caducidad con sus textos. Se pide al abrir el diálogo para que
  // ya esté disponible cuando llegue la respuesta, y sin él no se pintaría el resultado (saldrían claves).
  const sharesCatalogReady = useLazyCatalog('shares');

  function close() {
    if (confirmed === null) props.onClose();
    else props.onDone(confirmed.toastMessage);
  }

  function handleConfirmed(change: ConfirmedChange) {
    const { removedRoles, assignedRole, sharedAccountCount } = change.response;
    const hasNothingToReview =
      removedRoles.length === 0 && assignedRole === null && sharedAccountCount === 0;
    // Sin nada que revisar (p. ej. un ascenso) un paso extra solo estorba: se cierra y se avisa con el
    // aviso emergente, como cualquier otra acción confirmada.
    if (hasNothingToReview) props.onDone(change.toastMessage);
    else setConfirmed(change);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={t('rank.title', { ns: 'directory' })}
      description={
        confirmed === null
          ? t('rank.description', { ns: 'directory', name: props.person.displayName })
          : t('rank.result.description', { ns: 'directory', name: props.person.displayName })
      }
      closeLabel={t('dialog.close', { ns: 'common' })}
    >
      {confirmed === null ? (
        <ChangeRankForm {...props} onConfirmed={handleConfirmed} />
      ) : sharesCatalogReady ? (
        <ChangeRankResult person={props.person} change={confirmed} onAcknowledge={close} />
      ) : null}
    </Dialog>
  );
}
