import {
  ErrorCode,
  createRoleRequestSchema,
  type CreateRoleRequest,
  type Permission,
  type Role,
} from '@iam/contracts';
import {
  Alert,
  Badge,
  Button,
  FormField,
  IconBubble,
  Input,
  Panel,
  ShieldCheck,
  Spinner,
  Users,
  buttonVariants,
} from '@iam/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useId, useState, type ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import {
  ApiError,
  applyFieldErrors,
  useAsyncAction,
  useRateLimitCooldown,
} from '../../../shared/api';
import { useMe } from '../../../shared/auth';
import { ErrorAlert, useRoleLabel, useValidationMessage } from '../../../shared/i18n';
import { useLazyCatalog } from '../../../shared/i18n/use-lazy-catalog';
import { useToast } from '../../../shared/toast';
import { createRole, fetchRole, rolesKeys, updateRole } from '../api/roles-api';
import { groupPermissions } from '../model/permission-groups';
import { PermissionAreas } from '../ui/permission-areas';
import { RoleOptionsPanel } from '../ui/role-options-panel';

import { ArchiveRoleDialog } from './archive-role-dialog';

/** Crear y editar comparten forma: nombre y permisos (el servidor valida igual los dos). */
type RoleFormValues = CreateRoleRequest;

export type RoleEditorPageProps = {
  /** Rol a editar; sin él, la página crea uno nuevo. */
  roleId?: string | undefined;
  /** "Duplicar rol": al crear, parte del nombre y los permisos de este rol. */
  fromId?: string | undefined;
};

/**
 * Container de `/roles/new` y `/roles/$roleId`: el editor de rol a página completa del diseño de
 * Compass. Las plantillas del sistema y los roles con permisos que quien edita no tiene se muestran
 * en solo lectura. Las personas del rol y su descripción esperan a que la API los ofrezca.
 */
export function RoleEditorPage({ roleId, fromId }: RoleEditorPageProps) {
  const catalogReady = useLazyCatalog('roles');
  const { t } = useTranslation(['roles', 'common']);
  const sourceId = roleId ?? fromId;
  const roleQuery = useQuery({
    queryKey: rolesKeys.detail(sourceId ?? ''),
    queryFn: ({ signal }) => fetchRole(sourceId ?? '', signal),
    enabled: sourceId !== undefined,
  });

  const backLink = (
    <Link
      to="/roles"
      className="inline-flex min-h-6 items-center self-start text-sm text-accent underline underline-offset-4"
    >
      {t('editor.back', { ns: 'roles' })}
    </Link>
  );

  if (!catalogReady || (sourceId !== undefined && roleQuery.isPending)) {
    return <Spinner label={t('state.loading', { ns: 'common' })} />;
  }
  if (roleQuery.isError) {
    return (
      <div className="flex flex-col gap-4">
        {backLink}
        <ErrorAlert
          error={roleQuery.error}
          onRetry={() => {
            void roleQuery.refetch();
          }}
        />
      </div>
    );
  }

  const source = roleQuery.data ?? null;
  if (roleId !== undefined && source === null) {
    return (
      <div className="flex flex-col gap-4">
        {backLink}
        <Alert tone="info">{t('editor.notFound', { ns: 'roles' })}</Alert>
      </div>
    );
  }

  return (
    <RoleEditor
      // Cambiar de rol (o de origen al duplicar) reinicia el formulario.
      key={`${roleId ?? 'new'}:${fromId ?? ''}`}
      role={roleId !== undefined ? source : null}
      copyOf={roleId === undefined ? source : null}
      backLink={backLink}
    />
  );
}

type RoleEditorProps = {
  /** Rol que se edita; `null` al crear. */
  role: Role | null;
  /** Rol de partida al duplicar. */
  copyOf: Role | null;
  backLink: ReactNode;
};

function RoleEditor({ role, copyOf, backLink }: RoleEditorProps) {
  const { t } = useTranslation(['roles', 'common', 'errors']);
  const me = useMe();
  const available: readonly Permission[] = me?.permissions ?? [];
  const roleLabel = useRoleLabel();
  const validationMessage = useValidationMessage();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const formId = useId();
  const helpId = useId();
  const [archiving, setArchiving] = useState(false);

  const action = useAsyncAction((body: RoleFormValues) =>
    role === null ? createRole(body) : updateRole(role.id, body),
  );
  const cooldown = useRateLimitCooldown(action.error);

  // La regla de no escalamiento (ADR 0012) cuenta también los permisos que el rol ya tiene: si a
  // quien edita le falta alguno, el servidor rechazaría incluso quitárselo. Se muestra en solo
  // lectura en lugar de dejar que el envío falle sin explicación.
  const missingPermissions =
    role === null ? [] : role.permissions.filter((permission) => !available.includes(permission));
  const isSystem = role?.isSystem ?? false;
  const readOnly = isSystem || missingPermissions.length > 0;

  // Al duplicar solo se copian los permisos que quien crea puede otorgar.
  const copied = copyOf?.permissions.filter((permission) => available.includes(permission)) ?? [];
  const droppedOnCopy = (copyOf?.permissions.length ?? 0) - copied.length;

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    control,
    formState: { errors, isSubmitted },
  } = useForm<RoleFormValues>({
    resolver: zodResolver(createRoleRequestSchema),
    defaultValues:
      role !== null
        ? // Las plantillas muestran su nombre traducido; son de solo lectura y nunca se envían.
          { name: isSystem ? roleLabel(role) : role.name, permissions: [...role.permissions] }
        : {
            name:
              copyOf === null ? '' : t('editor.copyName', { ns: 'roles', name: roleLabel(copyOf) }),
            permissions: copied,
          },
  });
  const name = useWatch({ control, name: 'name' });
  const selected = useWatch({ control, name: 'permissions' });

  const groups = groupPermissions(readOnly && role !== null ? role.permissions : available).map(
    (group) => ({
      id: group.id,
      label: t(`permission.group.${group.id}`, { ns: 'roles' }),
      options: group.permissions.map((permission) => ({
        id: permission,
        label: t(`permission.${permission}`, { ns: 'roles' }),
      })),
    }),
  );

  /** Tras guardar o archivar: aviso, recarga de todo lo de roles y vuelta a la lista. */
  function finish(message: string) {
    toast.show(message, 'success');
    void queryClient.invalidateQueries({ queryKey: rolesKeys.all });
    void navigate({ to: '/roles' });
  }

  async function submit(values: RoleFormValues) {
    const result = await action.run(values);
    if (result.ok) {
      finish(
        t(role === null ? 'create.toast' : 'edit.toast', { ns: 'roles', name: result.value.name }),
      );
      return;
    }
    const { error } = result;
    if (error instanceof ApiError && error.code === ErrorCode.ROLE_NAME_TAKEN) {
      setError('name', { type: 'server', message: t('ROLE.NAME_TAKEN', { ns: 'errors' }) });
      action.reset();
      return;
    }
    // AUTHZ.ROLE_ESCALATION, NOT_FOUND y el resto se muestran en el aviso de la página.
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

  const title =
    role !== null
      ? roleLabel(role)
      : name.trim() === ''
        ? t('editor.newTitle', { ns: 'roles' })
        : name;

  return (
    <>
      {backLink}
      <div className="flex flex-wrap items-start gap-4">
        <IconBubble
          tone={isSystem ? 'success' : 'accent'}
          icon={isSystem ? <ShieldCheck className="size-6" /> : <Users className="size-6" />}
          className="size-14"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h1 className="truncate text-2xl text-text">{title}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{t(isSystem ? 'kind.system' : 'kind.custom', { ns: 'roles' })}</Badge>
            <Badge tone="accent">
              {t('editor.permissionCount', { ns: 'roles', count: selected.length })}
            </Badge>
          </div>
        </div>
        {readOnly ? null : (
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/roles" className={buttonVariants({ variant: 'secondary' })}>
              {t('actions.cancel', { ns: 'common' })}
            </Link>
            <Button
              type="submit"
              form={formId}
              loading={action.pending}
              disabled={cooldown.secondsLeft > 0}
            >
              {t(role === null ? 'create.submit' : 'edit.submit', { ns: 'roles' })}
            </Button>
          </div>
        )}
      </div>

      {action.error !== undefined ? (
        <ErrorAlert error={action.error} secondsLeft={cooldown.secondsLeft} />
      ) : null}
      {isSystem ? <Alert tone="info">{t('detail.systemNote', { ns: 'roles' })}</Alert> : null}
      {!isSystem && readOnly ? (
        <Alert tone="info">{t('edit.missingPermissions', { ns: 'roles' })}</Alert>
      ) : null}
      {droppedOnCopy > 0 ? (
        <Alert tone="info">{t('editor.copyDropped', { ns: 'roles', count: droppedOnCopy })}</Alert>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <form
          id={formId}
          noValidate
          onSubmit={(event) => {
            void handleSubmit(submit)(event);
          }}
          className="flex flex-col gap-6 lg:col-span-2"
        >
          <Panel title={t('editor.data', { ns: 'roles' })}>
            <div className="px-5 py-4">
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
                    readOnly={readOnly}
                    invalid={field['aria-invalid'] === true}
                  />
                )}
              </FormField>
            </div>
          </Panel>
          <Panel
            title={t('create.permissions', { ns: 'roles' })}
            aside={
              <span className="text-sm font-semibold text-accent">
                {t('editor.selected', { ns: 'roles', count: selected.length })}
              </span>
            }
          >
            <div className="flex flex-col gap-4 px-5 py-4">
              <p id={helpId} className="text-sm text-text-secondary">
                {t(readOnly ? 'editor.readOnlyHelp' : 'create.description', { ns: 'roles' })}
              </p>
              <PermissionAreas
                groups={groups}
                selected={selected}
                readOnly={readOnly}
                describedBy={helpId}
                emptyMessage={t(readOnly ? 'view.empty' : 'create.noPermissions', { ns: 'roles' })}
                selectAllText={t('editor.selectAll', { ns: 'roles' })}
                clearAllText={t('editor.clearAll', { ns: 'roles' })}
                selectAllLabel={(area) => t('editor.selectAllLabel', { ns: 'roles', area })}
                clearAllLabel={(area) => t('editor.clearAllLabel', { ns: 'roles', area })}
                onChange={(next) => {
                  // Tras un primer intento fallido, la validación sigue al cambiar (docs/frontend.md §8).
                  setValue('permissions', next as Permission[], { shouldValidate: isSubmitted });
                }}
                error={
                  errors.permissions !== undefined
                    ? errors.permissions.type === 'server' &&
                      errors.permissions.message !== undefined
                      ? errors.permissions.message
                      : t('create.permissionsRequired', { ns: 'roles' })
                    : undefined
                }
              />
            </div>
          </Panel>
        </form>
        {role !== null ? (
          <RoleOptionsPanel
            roleId={role.id}
            canArchive={!isSystem}
            onArchive={() => {
              setArchiving(true);
            }}
          />
        ) : null}
      </div>

      {archiving && role !== null ? (
        <ArchiveRoleDialog
          role={role}
          onClose={() => {
            setArchiving(false);
          }}
          onDone={() => {
            finish(t('archive.toast', { ns: 'roles', name: role.name }));
          }}
        />
      ) : null}
    </>
  );
}
