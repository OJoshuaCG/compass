-- 0043: permiso para ver la salud de las credenciales por grupo y por organización (tarea T3c de
-- `odd/tasks/credential-health.md`; decisión del dueño 2026-11-14, opción A: un solo permiso para ambos paneles).
--
-- Un permiso nuevo en el catálogo de la base:
--   credential.view_health -> techo 2  ver los paneles de salud (conteos de contraseñas débiles, repetidas o
--                                      viejas). Raíz, Administrador y Líder. Solo expone números y conteos:
--                                      nunca un secreto ni su huella. El alcance lo recorta el caso de uso:
--                                      Raíz y Administrador ven toda la organización; un Líder, solo los
--                                      grupos que gestiona.
--
-- El disparador de techos (0015) trata un permiso que `permission_rank_ceiling()` no conoce como violación
-- (falla cerrada); sin esta migración ningún rol con el permiso nuevo se podría asignar. No agrega tablas.
--
-- Esta migración:
--  * Redefine `permission_rank_ceiling()` con UNA línea nueva. El resto es idéntico a la definición de 0037:
--    ningún otro permiso cambia de techo. `permission-ceiling-sync.test.ts` lee la última definición y la
--    compara con `PERMISSION_CEILING`.
--  * Concede `credential.view_health` a los roles de SISTEMA vivos que ya tienen `group.manage_members`
--    (Raíz, Administrador y Líder), para que `sync-system-roles` no encuentre nada que cambiar después.
--
-- Lo que NO hace, a propósito:
--  * No toca roles personalizados: nunca reciben un permiso sin una concesión explícita de una persona.
--  * No toca roles archivados ni `user_roles`.
--  * No escribe auditoría: `audit_events` es una cadena de hashes por organización a la que solo añade la
--    aplicación. El cambio queda en esta migración (aplicada una vez, con suma de verificación) y en la
--    columna `version` de cada rol, que sube una unidad.
--
-- Seguridad a nivel de fila: `roles` tiene FORCE ROW LEVEL SECURITY y el migrador es NOSUPERUSER
-- NOBYPASSRLS; sin `app.org_id` un UPDATE tocaría cero filas. Mismo patrón de 0023, 0026, 0031 y 0037: se
-- levanta FORCE y se restaura dentro de esta misma transacción.

create or replace function permission_rank_ceiling(permission text)
  returns smallint
  language sql immutable parallel safe
  set search_path = pg_catalog
as $$
  -- NULL para un permiso desconocido: el disparador de 0015 lo trata como violación.
  select case permission
    when 'org.settings' then 0
    when 'role.manage' then 1
    when 'platform.manage' then 1
    when 'vault.inventory.read' then 1
    when 'vault.emergency_access' then 1
    when 'audit.read_all' then 1
    when 'sso.clients.manage' then 1
    when 'user.invite' then 2
    when 'user.invite_link' then 2
    when 'user.update' then 2
    when 'user.change_rank' then 1
    when 'user.transfer' then 2
    when 'user.deactivate' then 2
    when 'role.assign' then 2
    when 'group.create' then 2
    when 'group.manage_members' then 2
    when 'account.create' then 3
    when 'account.update' then 3
    when 'account.archive' then 2
    when 'credential.create' then 3
    when 'credential.update' then 3
    when 'credential.restore_version' then 3
    when 'credential.reveal_password' then 3
    when 'credential.use_totp' then 3
    when 'credential.export_totp' then 2
    when 'credential.view_health' then 2
    when 'share.manage' then 3
    when 'access_request.approve' then 2
    when 'rotation.manage' then 2
    when 'audit.read_scope' then 2
    when 'inbound.read_codes' then 3
    when 'inbound.configure' then 2
    when 'inbound.reveal_reset' then 1
    when 'inbound.delete_mail' then 2
    when 'alerts.infra.manage' then 0
    when 'alerts.security.manage' then 1
  end::smallint
$$;

-- Idempotente: la última condición hace que una segunda ejecución (o un rol ya sincronizado) no cambie nada.
alter table roles no force row level security;

update roles
   set permissions = array_append(permissions, 'credential.view_health'),
       version = version + 1
 where is_system
   and archived_at is null
   and 'group.manage_members' = any (permissions)
   and not ('credential.view_health' = any (permissions));

alter table roles force row level security;
