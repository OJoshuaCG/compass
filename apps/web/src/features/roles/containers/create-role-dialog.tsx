import {
  ErrorCode,
  createRoleRequestSchema,
  type CreateRoleRequest,
  type Permission,
} from '@iam/contracts';
import { Button, Dialog, FormField, Input } from '@iam/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import {
  ApiError,
  applyFieldErrors,
  useAsyncAction,
  useRateLimitCooldown,
} from '../../../shared/api';
import { ErrorAlert, useValidationMessage } from '../../../shared/i18n';
import { createRole } from '../api/roles-api';
import { groupPermissions } from '../model/permission-groups';
import { PermissionPicker } from '../ui/permission-picker';

type CreateRoleFormProps = {
  /** Permisos de quien crea: un rol solo puede contener los que ya tiene. */
  available: readonly Permission[];
  onCancel: () => void;
  onCreated: (name: string) => void;
};

function CreateRoleForm({ available, onCancel, onCreated }: CreateRoleFormProps) {
  const { t } = useTranslation(['roles', 'common', 'errors']);
  const validationMessage = useValidationMessage();
  // Sin secretos en juego: pero se evita la caché de mutaciones igual que en el resto de formularios.
  const action = useAsyncAction((body: CreateRoleRequest) => createRole(body));
  const cooldown = useRateLimitCooldown(action.error);

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    control,
    formState: { errors, isSubmitted },
  } = useForm<CreateRoleRequest>({
    resolver: zodResolver(createRoleRequestSchema),
    defaultValues: { name: '', permissions: [] },
  });
  const name = useWatch({ control, name: 'name' });
  const selected = useWatch({ control, name: 'permissions' });

  const groups = groupPermissions(available).map((group) => ({
    id: group.id,
    label: t(`permission.group.${group.id}`, { ns: 'roles' }),
    options: group.permissions.map((permission) => ({
      id: permission,
      label: t(`permission.${permission}`, { ns: 'roles' }),
    })),
  }));

  async function submit(values: CreateRoleRequest) {
    const result = await action.run(values);
    if (result.ok) {
      onCreated(result.value.name);
      return;
    }
    const { error } = result;
    if (error instanceof ApiError && error.code === ErrorCode.ROLE_NAME_TAKEN) {
      setError('name', { type: 'server', message: t('ROLE.NAME_TAKEN', { ns: 'errors' }) });
      action.reset();
      return;
    }
    // AUTHZ.ROLE_ESCALATION y el resto se muestran en el aviso del diálogo (`action.error`).
    if (
      applyFieldErrors(
        error,
        setError,
        ['name', 'permissions'],
        t('VALIDATION.FAILED', { ns: 'errors' }),
      )
    ) {
      action.reset();
    }
  }

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
        label={t('create.name', { ns: 'roles' })}
        required
        error={validationMessage(errors.name, { field: 'name', empty: name === '' })}
      >
        {(field) => (
          <Input
            {...field}
            {...register('name')}
            autoComplete="off"
            invalid={field['aria-invalid'] === true}
          />
        )}
      </FormField>
      <PermissionPicker
        legend={t('create.permissions', { ns: 'roles' })}
        help={t('create.permissionsHelp', { ns: 'roles' })}
        emptyMessage={t('create.noPermissions', { ns: 'roles' })}
        groups={groups}
        selected={selected}
        onChange={(next) => {
          // Tras un primer intento fallido, la validación sigue al cambiar (docs/frontend.md §8).
          setValue('permissions', next as Permission[], { shouldValidate: isSubmitted });
        }}
        error={
          errors.permissions !== undefined
            ? errors.permissions.type === 'server' && errors.permissions.message !== undefined
              ? errors.permissions.message
              : t('create.permissionsRequired', { ns: 'roles' })
            : undefined
        }
      />
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onCancel}>
          {t('actions.cancel', { ns: 'common' })}
        </Button>
        <Button type="submit" loading={action.pending} disabled={cooldown.secondsLeft > 0}>
          {t('create.submit', { ns: 'roles' })}
        </Button>
      </div>
    </form>
  );
}

export type CreateRoleDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  available: readonly Permission[];
  /** Éxito: recibe el nombre del rol creado; el padre avisa y recarga. */
  onCreated: (name: string) => void;
};

/** Diálogo "Crear rol": nombre y permisos limitados a los de quien lo crea. */
export function CreateRoleDialog({
  open,
  onOpenChange,
  available,
  onCreated,
}: CreateRoleDialogProps) {
  const { t } = useTranslation(['roles', 'common']);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('create.title', { ns: 'roles' })}
      description={t('create.description', { ns: 'roles' })}
      closeLabel={t('dialog.close', { ns: 'common' })}
    >
      {/* El formulario se monta solo con el diálogo abierto: al cerrar se descarta su estado. */}
      <CreateRoleForm
        available={available}
        onCancel={() => {
          onOpenChange(false);
        }}
        onCreated={onCreated}
      />
    </Dialog>
  );
}
