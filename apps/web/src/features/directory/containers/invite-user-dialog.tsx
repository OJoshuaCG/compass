import {
  ErrorCode,
  createInvitationRequestSchema,
  type CreateInvitationRequest,
  type Rank,
} from '@iam/contracts';
import { Button, Dialog, FormField, Input, NativeSelect } from '@iam/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useRef } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';

import { ApiError, applyFieldErrors, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert, useValidationMessage } from '../../../shared/i18n';
import { useToast } from '../../../shared/toast';
import { inviteUser } from '../api/directory-api';
import { creatableRanks } from '../model/creatable-ranks';

type FormInput = z.input<typeof createInvitationRequestSchema>;

type InviteFormProps = { actorRank: Rank; onDone: () => void };

function InviteForm({ actorRank, onDone }: InviteFormProps) {
  const { t } = useTranslation(['directory', 'common', 'errors']);
  const toast = useToast();
  const validationMessage = useValidationMessage();
  // Una clave por apertura del diálogo: si el envío se repite (reautenticación, red) el
  // servidor lo reconoce como la misma invitación en lugar de crear otra.
  const idempotencyKey = useRef(crypto.randomUUID());
  // Si el rango no permite ninguna opción se ofrecen todas: el servidor decide (es solo comodidad).
  const ranks = creatableRanks(actorRank);
  const options = ranks.length > 0 ? ranks : ([1, 2, 3] as const);

  const mutation = useMutation({
    mutationFn: (body: CreateInvitationRequest) => inviteUser(body, idempotencyKey.current),
  });
  const cooldown = useRateLimitCooldown(mutation.error);

  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<FormInput, unknown, CreateInvitationRequest>({
    resolver: zodResolver(createInvitationRequestSchema),
    // Por defecto, el rango de menor autoridad: el privilegio mínimo es la opción segura.
    defaultValues: { email: '', rank: options.at(-1) ?? 3, roleIds: [] },
  });
  const email = useWatch({ control, name: 'email' });

  function submit(values: CreateInvitationRequest) {
    mutation.mutate(values, {
      onSuccess: (invitation) => {
        toast.show(t('invite.sent', { ns: 'directory', email: invitation.email }), 'success');
        onDone();
      },
      onError: (error) => {
        if (error instanceof ApiError && error.code === ErrorCode.INVITATION_CONFLICT) {
          setError('email', {
            type: 'server',
            message: t('INVITATION.CONFLICT', { ns: 'errors' }),
          });
          mutation.reset();
          return;
        }
        if (
          applyFieldErrors(
            error,
            setError,
            ['email', 'rank'],
            t('VALIDATION.FAILED', { ns: 'errors' }),
          )
        ) {
          mutation.reset();
        }
      },
    });
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        void handleSubmit(submit)(event);
      }}
      className="flex flex-col gap-4"
    >
      {mutation.error !== null ? (
        <ErrorAlert error={mutation.error} secondsLeft={cooldown.secondsLeft} />
      ) : null}
      <FormField
        label={t('invite.email', { ns: 'directory' })}
        required
        error={validationMessage(errors.email, { field: 'email', empty: email === '' })}
      >
        {(field) => (
          <Input
            {...field}
            {...register('email')}
            type="email"
            autoComplete="off"
            invalid={field['aria-invalid'] === true}
          />
        )}
      </FormField>
      <FormField
        label={t('invite.rank', { ns: 'directory' })}
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
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onDone}>
          {t('actions.cancel', { ns: 'common' })}
        </Button>
        <Button type="submit" loading={mutation.isPending} disabled={cooldown.secondsLeft > 0}>
          {t('invite.submit', { ns: 'directory' })}
        </Button>
      </div>
    </form>
  );
}

export type InviteUserDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Rango de quien invita, para ofrecer solo rangos que puede crear. */
  actorRank: Rank;
};

/** Diálogo "Invitar usuario": react-hook-form + el esquema Zod del contrato. */
export function InviteUserDialog({ open, onOpenChange, actorRank }: InviteUserDialogProps) {
  const { t } = useTranslation(['directory', 'common']);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('invite.title', { ns: 'directory' })}
      description={t('invite.description', { ns: 'directory' })}
      closeLabel={t('dialog.close', { ns: 'common' })}
    >
      {/* El formulario se monta solo con el diálogo abierto: al cerrar se descarta su estado. */}
      <InviteForm
        actorRank={actorRank}
        onDone={() => {
          onOpenChange(false);
        }}
      />
    </Dialog>
  );
}
