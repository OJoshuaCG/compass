-- 0037: borrado de correo a petición del buzón real (ADR 0045, enmienda 2026-11-10).
--
-- Dos cambios:
--  1. `inbound_receipts` guarda la posición del mensaje en el buzón (UIDVALIDITY y UID). Es un par de
--     enteros, sin asunto, remitente ni cuerpo. Se guarda en el historial y no en `inbound_items` para que
--     un correo en cuarentena (cuya extracción falló) también se pueda localizar y borrar. Se purga junto
--     con la fila del historial. Los recibos anteriores y los de SMS quedan en NULL: de esos no se puede
--     borrar nada desde Compass.
--  2. Permiso nuevo `inbound.delete_mail` (techo 2). El techo permite que quien dio de alta una fuente y
--     es Líder también pueda borrar; el caso de uso exige además que quien borre sea Administrador o
--     superior, o la persona que dio de alta la fuente. Pide reautenticación reciente y deja auditoría
--     crítica (política en `permission-catalog.ts`).
--
-- El disparador de techos (0015) trata un permiso que `permission_rank_ceiling()` no conoce como
-- violación (falla cerrada); sin esta migración ningún rol con el permiso nuevo se podría asignar.
--
-- Esta migración:
--  * Redefine `permission_rank_ceiling()` con UNA línea nueva. El resto es idéntico a la definición de
--    0031: ningún otro permiso cambia de techo. `permission-ceiling-sync.test.ts` lee la última
--    definición y la compara con `PERMISSION_CEILING`.
--  * Concede `inbound.delete_mail` a los roles de SISTEMA vivos que ya tienen `inbound.configure`
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
-- NOBYPASSRLS; sin `app.org_id` un UPDATE tocaría cero filas. Mismo patrón de 0023, 0026 y 0031: se
-- levanta FORCE y se restaura dentro de esta misma transacción.

alter table inbound_receipts
  add column mailbox_uid_validity bigint
    check (mailbox_uid_validity is null or mailbox_uid_validity between 0 and 4294967295),
  add column mailbox_uid bigint
    check (mailbox_uid is null or mailbox_uid between 1 and 4294967295),
  -- Las dos columnas van juntas: un UID sin su UIDVALIDITY no significa nada.
  add constraint inbound_receipts_mailbox_position_together
    check ((mailbox_uid is null) = (mailbox_uid_validity is null));
comment on column inbound_receipts.mailbox_uid_validity is
  'UIDVALIDITY del buzón IMAP cuando llegó el mensaje; si cambió, el UID guardado ya no apunta a nada.';
comment on column inbound_receipts.mailbox_uid is
  'UID del mensaje en el buzón IMAP, para borrarlo a petición. Nulo en recibos de SMS y anteriores a la 0037. No identifica el contenido.';

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
   set permissions = array_append(permissions, 'inbound.delete_mail'),
       version = version + 1
 where is_system
   and archived_at is null
   and 'inbound.configure' = any (permissions)
   and not ('inbound.delete_mail' = any (permissions));

alter table roles force row level security;
