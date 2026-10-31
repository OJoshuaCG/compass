import {
  PERMISSIONS,
  type ManagedUser,
  type Permission,
  type PersonRoles,
  type Role,
} from '@iam/contracts';
import { Button, Dialog, Spinner } from '@iam/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { useMe } from '../../../shared/auth';
import { ErrorAlert } from '../../../shared/i18n';
import { useLazyCatalog } from '../../../shared/i18n/use-lazy-catalog';
import { useToast } from '../../../shared/toast';
import { fetchPermissionCatalog, groupPermissions, PermissionPicker, rolesKeys } from '../../roles';
import {
  directoryKeys,
  fetchAssignableRoles,
  fetchPersonRoles,
  setPersonRoles,
  setSpecialPermissions,
} from '../api/directory-api';
import { RoleChoices } from '../ui/role-choices';

export type PersonAccessDialogProps = {
  person: ManagedUser;
  onClose: () => void;
};

type PersonAccessFormProps = {
  person: ManagedUser;
  current: PersonRoles;
  allRoles: readonly Role[];
  /**
   * Permisos que se pueden ofrecer: los que el rango de la persona admite y que quien edita posee.
   * `undefined` si no hay ningún dato para filtrar (el servidor decide al guardar).
   */
  allowedPermissions: readonly Permission[] | undefined;
  /** El catálogo del rango falló: se avisa que la validación queda del lado del servidor. */
  catalogFailed: boolean;
};

/** Compara como conjuntos: el orden de marcado no cuenta como un cambio. */
function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (leftSet.size !== rightSet.size) return false;
  return [...leftSet].every((value) => rightSet.has(value));
}

/** Intersección de dos filtros opcionales: un `undefined` significa "sin filtro", no "vacío". */
function intersectPermissions(
  first: readonly Permission[] | undefined,
  second: readonly Permission[] | undefined,
): readonly Permission[] | undefined {
  if (first === undefined) return second;
  if (second === undefined) return first;
  return first.filter((permission) => second.includes(permission));
}

/** Roles asignables más los que la persona ya tiene, sin repetir, para que ninguno quede invisible. */
function mergeRoles(allRoles: readonly Role[], assigned: readonly Role[]): Role[] {
  const known = new Set(allRoles.map((role) => role.id));
  return [...allRoles, ...assigned.filter((role) => !known.has(role.id))];
}

function PersonAccessForm({
  person,
  current,
  allRoles,
  allowedPermissions,
  catalogFailed,
}: PersonAccessFormProps) {
  const { t } = useTranslation(['directory', 'roles', 'common']);
  const toast = useToast();
  const queryClient = useQueryClient();
  const [roleIds, setRoleIds] = useState<string[]>(() => current.roles.map((role) => role.id));
  const [special, setSpecial] = useState<Permission[]>(() => [...current.specialPermissions]);
  // Lo último guardado: arranca en lo que llegó del servidor y pasa a lo enviado tras un guardado
  // correcto, para que el botón se deshabilite de nuevo sin esperar a la recarga.
  const [savedRoleIds, setSavedRoleIds] = useState<string[]>(() =>
    current.roles.map((role) => role.id),
  );
  const [savedSpecial, setSavedSpecial] = useState<Permission[]>(() => [
    ...current.specialPermissions,
  ]);
  const rolesChanged = !sameSet(roleIds, savedRoleIds);
  const specialChanged = !sameSet(special, savedSpecial);

  // La reautenticación la gestiona el cliente HTTP: abre su diálogo y reintenta UNA vez.
  const rolesAction = useAsyncAction((ids: string[]) => setPersonRoles(person.id, ids));
  const specialAction = useAsyncAction((permissions: Permission[]) =>
    setSpecialPermissions(person.id, permissions),
  );
  const rolesCooldown = useRateLimitCooldown(rolesAction.error);
  const specialCooldown = useRateLimitCooldown(specialAction.error);

  // Sin datos para filtrar se ofrece todo y decide el servidor; con ellos, solo lo que admite el
  // rango y quien edita posee. Los permisos ya asignados siempre se muestran para poder verlos y
  // retirarlos.
  const offered = new Set<Permission>([
    ...(allowedPermissions ?? PERMISSIONS),
    ...current.specialPermissions,
  ]);
  const permissionGroups = groupPermissions([...offered]).map((group) => ({
    id: group.id,
    label: t(`permission.group.${group.id}`, { ns: 'roles' }),
    options: group.permissions.map((permission) => ({
      id: permission,
      label: t(`permission.${permission}`, { ns: 'roles' }),
    })),
  }));

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: directoryKeys.personRoles(person.id) });
  }

  async function submitRoles(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (rolesCooldown.secondsLeft > 0) return;
    const result = await rolesAction.run(roleIds);
    if (result.ok) {
      setSavedRoleIds(roleIds);
      toast.show(t('access.roles.toast', { ns: 'directory', name: person.displayName }), 'success');
      refresh();
    }
  }

  async function submitSpecial(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (specialCooldown.secondsLeft > 0) return;
    const result = await specialAction.run(special);
    if (result.ok) {
      setSavedSpecial(special);
      toast.show(
        t('access.special.toast', { ns: 'directory', name: person.displayName }),
        'success',
      );
      refresh();
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        noValidate
        onSubmit={(event) => {
          void submitRoles(event);
        }}
        className="flex flex-col gap-3"
      >
        {rolesAction.error !== undefined ? (
          <ErrorAlert error={rolesAction.error} secondsLeft={rolesCooldown.secondsLeft} />
        ) : null}
        {allRoles.length === 0 && current.roles.length === 0 ? (
          <p className="text-sm text-text-secondary">
            {t('access.roles.empty', { ns: 'directory' })}
          </p>
        ) : (
          <RoleChoices
            legend={t('access.roles.legend', { ns: 'directory' })}
            help={t('access.roles.help', { ns: 'directory' })}
            roles={mergeRoles(allRoles, current.roles)}
            selected={roleIds}
            onChange={setRoleIds}
            unsavedLabel={rolesChanged ? t('access.unsaved', { ns: 'directory' }) : undefined}
          />
        )}
        <div className="flex justify-end">
          <Button
            type="submit"
            loading={rolesAction.pending}
            disabled={!rolesChanged || rolesCooldown.secondsLeft > 0}
          >
            {t('access.roles.submit', { ns: 'directory' })}
          </Button>
        </div>
      </form>
      <form
        noValidate
        onSubmit={(event) => {
          void submitSpecial(event);
        }}
        className="flex flex-col gap-3"
      >
        {specialAction.error !== undefined ? (
          <ErrorAlert error={specialAction.error} secondsLeft={specialCooldown.secondsLeft} />
        ) : null}
        <PermissionPicker
          legend={t('access.special.legend', { ns: 'directory' })}
          help={t('access.special.help', { ns: 'directory' })}
          extraHelp={t('access.special.helpLimits', { ns: 'directory' })}
          notice={catalogFailed ? t('access.special.catalogError', { ns: 'directory' }) : undefined}
          unsavedLabel={specialChanged ? t('access.unsaved', { ns: 'directory' }) : undefined}
          emptyMessage={t('access.special.empty', { ns: 'directory' })}
          groups={permissionGroups}
          selected={special}
          required={false}
          onChange={(next) => {
            setSpecial(next as Permission[]);
          }}
        />
        <div className="flex justify-end">
          <Button
            type="submit"
            loading={specialAction.pending}
            disabled={!specialChanged || specialCooldown.secondsLeft > 0}
          >
            {t('access.special.submit', { ns: 'directory' })}
          </Button>
        </div>
      </form>
    </div>
  );
}

/**
 * Diálogo "Roles y permisos" de una persona: sus roles (plantillas de sistema y personalizados) y
 * sus permisos especiales, cada bloque con su propio botón de guardado para que un fallo en uno no
 * deje el otro a medias. Los permisos que se ofrecen siguen el catálogo del rango de la persona; es
 * comodidad de la UI, el servidor decide (escalamiento, reautenticación y alcance).
 */
export function PersonAccessDialog({ person, onClose }: PersonAccessDialogProps) {
  const { t } = useTranslation(['directory', 'common']);
  // Los textos de permisos y áreas viven en el catálogo diferido de `roles`.
  const rolesCatalogReady = useLazyCatalog('roles');
  const me = useMe();

  const personQuery = useQuery({
    queryKey: directoryKeys.personRoles(person.id),
    queryFn: ({ signal }) => fetchPersonRoles(person.id, signal),
    staleTime: 0,
    // Sin caché entre aperturas: el formulario toma su estado inicial de estos datos y guardar
    // reemplaza el conjunto completo, así que mostrar los de una apertura anterior podría pisar un
    // cambio hecho por otra persona.
    gcTime: 0,
  });
  const rolesQuery = useQuery({
    queryKey: directoryKeys.assignableRoles(),
    queryFn: ({ signal }) => fetchAssignableRoles(signal),
    staleTime: 0,
  });
  // Opcional: sin él (p. ej. 403) se ofrecen todos los permisos y el servidor valida.
  const catalogQuery = useQuery({
    queryKey: rolesKeys.permissionCatalog(),
    queryFn: ({ signal }) => fetchPermissionCatalog(signal),
    retry: false,
  });

  // Un fallo al recargar tras guardar no debe descartar lo que la persona está editando.
  const loadError =
    personQuery.isError && personQuery.data === undefined
      ? personQuery
      : rolesQuery.isError && rolesQuery.data === undefined
        ? rolesQuery
        : undefined;
  const isLoading =
    !rolesCatalogReady || personQuery.isPending || rolesQuery.isPending || catalogQuery.isPending;

  const rankPermissions = catalogQuery.isSuccess
    ? catalogQuery.data
        .filter((entry) => entry.maxRank >= person.rank)
        .map((entry) => entry.permission)
    : undefined;
  // Quien edita solo puede otorgar lo que ya tiene. Si su perfil aún no cargó no se filtra por esto
  // y decide el servidor.
  const editorPermissions = me?.permissions;
  const allowedPermissions = intersectPermissions(rankPermissions, editorPermissions);

  function renderBody() {
    if (loadError !== undefined) {
      return (
        <ErrorAlert
          error={loadError.error}
          onRetry={() => {
            void loadError.refetch();
          }}
        />
      );
    }
    if (isLoading || !personQuery.isSuccess || !rolesQuery.isSuccess) {
      return <Spinner label={t('state.loading', { ns: 'common' })} />;
    }
    return (
      <PersonAccessForm
        person={person}
        current={personQuery.data}
        allRoles={rolesQuery.data}
        allowedPermissions={allowedPermissions}
        catalogFailed={catalogQuery.isError}
      />
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('access.title', { ns: 'directory', name: person.displayName })}
      description={t('access.description', { ns: 'directory' })}
      closeLabel={t('dialog.close', { ns: 'common' })}
    >
      {renderBody()}
      <div className="mt-6 flex justify-end">
        <Button type="button" variant="secondary" onClick={onClose}>
          {t('dialog.close', { ns: 'common' })}
        </Button>
      </div>
    </Dialog>
  );
}
