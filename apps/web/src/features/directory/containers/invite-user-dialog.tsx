import {
  ErrorCode,
  createInvitationRequestSchema,
  type CreateInvitationRequest,
  type CreateInvitationWithLinkResponse,
  type Rank,
} from '@iam/contracts';
import { Button, Checkbox, Dialog, FormField, Input, NativeSelect } from '@iam/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';

import {
  ApiError,
  applyFieldErrors,
  useAsyncAction,
  useRateLimitCooldown,
} from '../../../shared/api';
import { useMe, usePermission } from '../../../shared/auth';
import { ErrorAlert, useValidationMessage } from '../../../shared/i18n';
import { useToast } from '../../../shared/toast';
import {
  directoryKeys,
  fetchInvitableRoles,
  inviteUser,
  inviteUserWithLink,
} from '../api/directory-api';
import { fetchInvitableManagers } from '../api/team-api';
import { creatableRanks } from '../model/creatable-ranks';
import { invitableManagers } from '../model/invitable-managers';
import { InvitationLinkPanel } from '../ui/invitation-link-panel';
import { RoleChoices } from '../ui/role-choices';

type FormInput = z.input<typeof createInvitationRequestSchema>;

type InviteFormProps = {
  actorRank: Rank;
  onDone: () => void;
  /** Entrega la respuesta con enlace al diálogo, que es quien la muestra y la descarta al cerrar. */
  onLinkReady: (invitation: CreateInvitationWithLinkResponse) => void;
};

function InviteForm({ actorRank, onDone, onLinkReady }: InviteFormProps) {
  const { t } = useTranslation(['directory', 'common', 'errors']);
  const toast = useToast();
  const queryClient = useQueryClient();
  const validationMessage = useValidationMessage();
  // La clave se estabiliza solo ante reintentos de la MISMA petición (mismo cuerpo): si el envío
  // se repite (reautenticación, red) el servidor lo reconoce como la misma invitación. Si el
  // usuario edita el correo o el rango, o la petición terminó en conflicto/validación, es otra
  // petición y necesita clave nueva (si no, el servidor devolvería la respuesta anterior).
  const attempt = useRef<{ key: string; body: string } | null>(null);
  function keyFor(body: CreateInvitationRequest): string {
    const serialized = JSON.stringify(body);
    if (attempt.current?.body !== serialized) {
      attempt.current = { key: crypto.randomUUID(), body: serialized };
    }
    return attempt.current.key;
  }
  // Si el rango no permite ninguna opción se ofrecen todas: el servidor decide (es solo comodidad).
  const ranks = creatableRanks(actorRank);
  const options = ranks.length > 0 ? ranks : ([1, 2, 3] as const);

  // Roles personalizados que se pueden elegir. Sin ellos (o si la consulta falla) el formulario no
  // muestra nada: es opcional y el servidor decide qué roles puede dar quien invita.
  const rolesQuery = useQuery({
    queryKey: directoryKeys.invitableRoles(),
    queryFn: ({ signal }) => fetchInvitableRoles(signal),
    // Pueden crearse o archivarse en `/roles` en cualquier momento.
    staleTime: 0,
  });
  const roles = rolesQuery.data ?? [];

  // Posibles responsables (el subárbol de quien invita). Es opcional: si la consulta falla o no hay
  // nadie elegible, el campo no se muestra y el servidor deja como responsable a quien invita.
  const actorId = useMe()?.user.id;
  const managersQuery = useQuery({
    queryKey: directoryKeys.invitableManagers(),
    queryFn: ({ signal }) => fetchInvitableManagers(signal),
    // Un traspaso o una baja pueden cambiar el subárbol en cualquier momento.
    staleTime: 0,
  });

  const mutation = useMutation({
    mutationFn: (body: CreateInvitationRequest) => inviteUser(body, keyFor(body)),
  });
  // Ruta con enlace: `useAsyncAction` y no `useMutation`, porque la caché de mutaciones conservaría
  // la respuesta (con el enlace) mientras el componente siga montado (docs/frontend.md §9). Tampoco
  // lleva clave de idempotencia: el servidor no debe guardar el enlace.
  const linkAction = useAsyncAction((body: CreateInvitationRequest) => inviteUserWithLink(body));
  const canShowLink = usePermission('user.invite_link');
  const [wantsLink, setWantsLink] = useState(false);
  const linkOptionId = useId();
  const linkOptionHelpId = `${linkOptionId}-help`;
  const submitError: unknown = mutation.error ?? linkAction.error;
  const hasSubmitError = submitError !== null && submitError !== undefined;
  const cooldown = useRateLimitCooldown(submitError);

  function resetSubmitErrors() {
    mutation.reset();
    linkAction.reset();
  }

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    control,
    formState: { errors },
  } = useForm<FormInput, unknown, CreateInvitationRequest>({
    resolver: zodResolver(createInvitationRequestSchema),
    // Por defecto, el rango de menor autoridad: el privilegio mínimo es la opción segura.
    // Sin `managerId`: el servidor asigna como responsable a quien invita.
    defaultValues: { email: '', rank: options.at(-1) ?? 3, roleIds: [] },
  });
  const email = useWatch({ control, name: 'email' });
  const roleIds = useWatch({ control, name: 'roleIds' }) ?? [];
  const rank = useWatch({ control, name: 'rank' });
  const managerId = useWatch({ control, name: 'managerId' });
  // Al subir el rango del invitado, un responsable elegido antes puede dejar de ser elegible: en
  // ese caso se vuelve a mostrar la opción por defecto y no se envía.
  const managers = invitableManagers(managersQuery.data ?? [], actorId, rank);
  const selectedManagerId = managers.some((manager) => manager.id === managerId)
    ? managerId
    : undefined;

  function handleSubmitError(error: unknown) {
    // 422: algún rol ya no existe o se archivó; se recarga la lista para no volver a ofrecerlo.
    if (error instanceof ApiError && error.status === 422) {
      void queryClient.invalidateQueries({ queryKey: directoryKeys.invitableRoles() });
    }
    if (
      error instanceof ApiError &&
      (error.code === ErrorCode.INVITATION_CONFLICT || error.status === 422)
    ) {
      // Respuesta definitiva del servidor: la próxima petición es nueva.
      attempt.current = null;
    }
    // Reglas de responsable (fuera del subárbol o rango insuficiente): se muestran junto al campo
    // y la lista se recarga porque el subárbol pudo cambiar desde que se abrió el diálogo.
    if (
      error instanceof ApiError &&
      (error.code === ErrorCode.USER_MANAGER_RANK_INVALID ||
        error.code === ErrorCode.AUTHZ_HIERARCHY_NOT_IN_SUBTREE)
    ) {
      attempt.current = null;
      void queryClient.invalidateQueries({ queryKey: directoryKeys.invitableManagers() });
      setError('managerId', { type: 'server', message: t(error.code, { ns: 'errors' }) });
      resetSubmitErrors();
      return;
    }
    if (error instanceof ApiError && error.code === ErrorCode.INVITATION_CONFLICT) {
      setError('email', {
        type: 'server',
        message: t('INVITATION.CONFLICT', { ns: 'errors' }),
      });
      resetSubmitErrors();
      return;
    }
    if (
      applyFieldErrors(
        error,
        setError,
        ['email', 'rank', 'managerId'],
        t('VALIDATION.FAILED', { ns: 'errors' }),
      )
    ) {
      resetSubmitErrors();
    }
  }

  async function submitWithLink(body: CreateInvitationRequest) {
    const result = await linkAction.run(body);
    if (!result.ok) {
      handleSubmitError(result.error);
      return;
    }
    // La lista de pendientes debe mostrar la invitación nueva; el enlace no pasa por Query.
    void queryClient.invalidateQueries({ queryKey: directoryKeys.invitations() });
    onLinkReady(result.value);
  }

  function submit(values: CreateInvitationRequest) {
    // Un rol archivado entre tanto (la lista se recargó) ya no se envía.
    // El responsable solo se envía si sigue siendo elegible; si no, se omite y el servidor usa a
    // quien invita.
    const body: CreateInvitationRequest = {
      email: values.email,
      rank: values.rank,
      roleIds: values.roleIds.filter((id) => roles.some((r) => r.id === id)),
      ...(selectedManagerId === undefined ? {} : { managerId: selectedManagerId }),
    };
    if (canShowLink && wantsLink) {
      void submitWithLink(body);
      return;
    }
    mutation.mutate(body, {
      onSuccess: (invitation) => {
        toast.show(t('invite.sent', { ns: 'directory', email: invitation.email }), 'success');
        // La lista de pendientes (otra pestaña de la página) debe mostrar la invitación nueva.
        void queryClient.invalidateQueries({ queryKey: directoryKeys.invitations() });
        onDone();
      },
      onError: handleSubmitError,
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
      {hasSubmitError ? (
        <ErrorAlert error={submitError} secondsLeft={cooldown.secondsLeft} />
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
      {managers.length > 0 ? (
        <FormField
          label={t('invite.manager', { ns: 'directory' })}
          help={t('invite.managerHelp', { ns: 'directory' })}
          error={validationMessage(errors.managerId, { field: 'managerId' })}
        >
          {(field) => (
            <NativeSelect
              {...field}
              value={selectedManagerId ?? ''}
              onChange={(event) => {
                const chosen = event.target.value;
                setValue('managerId', chosen === '' ? undefined : chosen);
              }}
              invalid={field['aria-invalid'] === true}
            >
              <option value="">{t('invite.managerSelf', { ns: 'directory' })}</option>
              {managers.map((manager) => (
                <option key={manager.id} value={manager.id}>
                  {`${manager.displayName} · ${manager.email} · ${t(`rank.${String(manager.rank)}`, { ns: 'common' })}`}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
      ) : null}
      {roles.length > 0 ? (
        <RoleChoices
          legend={t('invite.roles', { ns: 'directory' })}
          help={t('invite.rolesHelp', { ns: 'directory' })}
          roles={roles}
          selected={roleIds}
          onChange={(next) => {
            setValue('roleIds', next);
          }}
        />
      ) : null}
      {canShowLink ? (
        <div className="flex flex-col gap-1">
          <label
            htmlFor={linkOptionId}
            className="flex min-h-6 items-start gap-2 text-sm text-text"
          >
            <Checkbox
              id={linkOptionId}
              checked={wantsLink}
              aria-describedby={linkOptionHelpId}
              onChange={(event) => {
                setWantsLink(event.target.checked);
              }}
            />
            <span>{t('invite.link.option', { ns: 'directory' })}</span>
          </label>
          <p id={linkOptionHelpId} className="ps-8 text-sm text-text-secondary">
            {t('invite.link.optionHelp', { ns: 'directory' })}
          </p>
        </div>
      ) : null}
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onDone}>
          {t('actions.cancel', { ns: 'common' })}
        </Button>
        <Button
          type="submit"
          loading={mutation.isPending || linkAction.pending}
          disabled={cooldown.secondsLeft > 0}
        >
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

/**
 * Diálogo "Invitar usuario": react-hook-form + el esquema Zod del contrato. Si la persona pidió ver
 * el enlace, la misma ventana pasa del formulario al panel con el enlace.
 */
export function InviteUserDialog({ open, onOpenChange, actorRank }: InviteUserDialogProps) {
  const { t } = useTranslation(['directory', 'common']);
  const timeZone = useMe()?.user.timezone;
  // El enlace vive solo aquí (estado local): ni Query, ni almacenamiento, ni URL. Se descarta al
  // cerrar el diálogo; para volver a verlo hay que reenviar la invitación.
  const [linkInvitation, setLinkInvitation] = useState<CreateInvitationWithLinkResponse | null>(
    null,
  );
  // Si el diálogo se cierra desde fuera (sin pasar por `onOpenChange`) el enlace también se pierde.
  if (!open && linkInvitation !== null) setLinkInvitation(null);

  function handleOpenChange(next: boolean) {
    if (!next) setLinkInvitation(null);
    onOpenChange(next);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t(linkInvitation === null ? 'invite.title' : 'link.title', { ns: 'directory' })}
      description={
        linkInvitation === null
          ? t('invite.description', { ns: 'directory' })
          : t('link.description', { ns: 'directory', email: linkInvitation.email })
      }
      closeLabel={t('dialog.close', { ns: 'common' })}
    >
      {/* El formulario se monta solo con el diálogo abierto: al cerrar se descarta su estado. */}
      {linkInvitation === null ? (
        <InviteForm
          actorRank={actorRank}
          onDone={() => {
            handleOpenChange(false);
          }}
          onLinkReady={setLinkInvitation}
        />
      ) : (
        <InvitationLinkPanel
          invitation={linkInvitation}
          timeZone={timeZone}
          onClose={() => {
            handleOpenChange(false);
          }}
        />
      )}
    </Dialog>
  );
}
