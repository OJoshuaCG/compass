import {
  ErrorCode,
  updateRoleRequestSchema,
  type Permission,
  type Role,
  type UpdateRoleRequest,
} from '@iam/contracts';
import { Button, Dialog, FormField, Input } from '@iam/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { ApiError, applyFieldErrors, useAsyncAction } from '../../../shared/api';
import { ErrorAlert, useValidationMessage } from '../../../shared/i18n';
import { updateRole } from '../api/roles-api';
import { groupPermissions } from '../model/permission-groups';
import { PermissionPicker } from '../ui/permission-picker';

type EditRoleFormProps = {
  role: Role;
  /** Permisos de quien edita: el servidor exige que los tenga todos, los actuales y los nuevos. */
  available: readonly Permission[];
  onCancel: () => void;
  onUpdated: (name: string) => void;
};

function EditRoleForm({ role, available, onCancel, onUpdated }: EditRoleFormProps) {
  const { t } = useTranslation(['roles', 'common', 'errors']);
  const validationMessage = useValidationMessage();
  const action = useAsyncAction((body: UpdateRoleRequest) => updateRole(role.id, body));

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    control,
    formState: { errors, isSubmitted },
  } = useForm<UpdateRoleRequest>({
    resolver: zodResolver(updateRoleRequestSchema),
    defaultValues: { name: role.name, permissions: [...role.permissions] },
  });
  const name = useWatch({ control, name: 'name' });
  const selected = useWatch({ control, name: 'permissions' });

  // La regla de no escalamiento (ADR 0012) cuenta también los permisos que el rol ya tiene: si a
  // quien edita le falta alguno, el servidor rechazaría incluso quitárselo. Se avisa de antemano
  // en lugar de dejar que el envío falle sin explicación.
  const missingPermissions = role.permissions.filter(
    (permission) => !available.includes(permission),
  );
  const canEdit = missingPermissions.length === 0;

  const groups = groupPermissions(available).map((group) => ({
    id: group.id,
    label: t(`permission.group.${group.id}`, { ns: 'roles' }),
    options: group.permissions.map((permission) => ({
      id: permission,
      label: t(`permission.${permission}`, { ns: 'roles' }),
    })),
  }));

  async function submit(values: UpdateRoleRequest) {
    const result = await action.run(values);
    if (result.ok) {
      onUpdated(result.value.name);
      return;
    }
    const { error } = result;
    if (error instanceof ApiError && error.code === ErrorCode.ROLE_NAME_TAKEN) {
      setError('name', { type: 'server', message: t('ROLE.NAME_TAKEN', { ns: 'errors' }) });
      action.reset();
      return;
    }
    // AUTHZ.ROLE_ESCALATION, NOT_FOUND y el resto se muestran en el aviso del diálogo.
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
      {action.error !== undefined ? <ErrorAlert error={action.error} /> : null}
      {canEdit ? null : (
        <p role="status" className="text-sm text-text-secondary">
          {t('edit.missingPermissions', { ns: 'roles' })}
        </p>
      )}
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
            disabled={!canEdit}
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
        <Button type="submit" loading={action.pending} disabled={!canEdit}>
          {t('edit.submit', { ns: 'roles' })}
        </Button>
      </div>
    </form>
  );
}

export type EditRoleDialogProps = {
  role: Role;
  available: readonly Permission[];
  onClose: () => void;
  /** Éxito: recibe el nombre ya guardado; el padre avisa y recarga. */
  onUpdated: (name: string) => void;
};

/** Diálogo "Editar rol": renombra y reemplaza los permisos de un rol personalizado. */
export function EditRoleDialog({ role, available, onClose, onUpdated }: EditRoleDialogProps) {
  const { t } = useTranslation(['roles', 'common']);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('edit.title', { ns: 'roles', name: role.name })}
      description={t('edit.description', { ns: 'roles' })}
      closeLabel={t('dialog.close', { ns: 'common' })}
    >
      <EditRoleForm role={role} available={available} onCancel={onClose} onUpdated={onUpdated} />
    </Dialog>
  );
}
