-- 0025: resolución previa a la organización de direcciones entrantes y rol del worker (ADR 0045,
-- IC-2c).
--
-- Un mensaje entrante llega de un tercero: la organización se deduce SOLO de la dirección de
-- destino, antes de que exista `app.org_id`, así que el aislamiento por filas devuelve cero filas
-- por diseño. Esta migración añade la segunda excepción acotada de ese tipo (la primera es la 0008):
--
--  * `auth.resolve_inbound_address(channel, address)`: SECURITY DEFINER, dueño `iam_auth_reader`
--    (sin BYPASSRLS), `search_path` fijo, una sola búsqueda exacta (nunca un listado ni un patrón),
--    columnas mínimas. Una dirección archivada devuelve lo mismo que una inexistente: cero filas.
--  * Guardia de espacio de nombres compartido con `accounts.recovery_email_alias` (diferido desde
--    IC-2b): un trigger por tabla, con función SECURITY DEFINER, porque bajo el aislamiento por filas
--    una restricción entre tablas no puede ver otras organizaciones. Una dirección puede coincidir con
--    un alias solo si la fuente está ligada a esa misma cuenta (el alias de una cuenta "es" la
--    dirección de su fuente, ADR 0045 sección 4). Un candado consultivo por dirección serializa las dos
--    escrituras concurrentes que, sin él, pasarían ambas la comprobación. Supone aislamiento READ
--    COMMITTED (el predeterminado y el que usa la API): cada consulta toma una instantánea nueva y
--    ve lo que la otra transacción confirmó mientras esperaba el candado; bajo REPEATABLE READ o
--    SERIALIZABLE no bastaría. Ambos errores llevan el mismo texto y el mismo código 23505 para no dar
--    dos oráculos distintos; la API debe responder igual a cualquier 23505 de estas tablas.
--  * Rol `iam_inbound_worker`: el proceso que recibe y procesa mensajes no es la API. Solo lee lo
--    necesario para extraer y solo inserta elementos y recibos; nunca lee el valor cifrado, nunca
--    actualiza ni borra (la purga la hace el trabajo de purga). Límites que la base NO impone, igual
--    que con `iam_app`: (a) la base no puede saber que `ciphertext` salió del módulo de criptografía,
--    solo exige largo mínimo; que el valor vaya cifrado es disciplina del código (la llave de datos la
--    pide IC-3, y la comprobación de la llave foránea no exige privilegios sobre `data_keys`); (b) el
--    rol puede fijar `app.org_id` a cualquier organización, como cualquier sesión de la aplicación: el
--    aislamiento por filas protege de errores y de otras organizaciones solo mientras el proceso fija
--    la organización que resolvió. Por eso el worker no recibe nada más que lo listado abajo.
--
-- Prerrequisito de despliegue: el rol lo crea `bootstrapRoles()` (db/src/bootstrap.ts) con una
-- conexión de administrador, como los demás; volver a correrlo es idempotente.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'iam_inbound_worker') then
    raise exception 'missing database role: iam_inbound_worker. Run the bootstrap step (db/src/bootstrap.ts) with an admin connection first.';
  end if;
  if exists (select 1 from pg_roles where rolname = 'iam_inbound_worker' and (rolbypassrls or rolsuper)) then
    raise exception 'iam_inbound_worker must not have BYPASSRLS or SUPERUSER';
  end if;
end
$$;

-- Permisos de columna del rol definidor: lo mínimo para resolver y para la guardia de alias.
grant select (id, organization_id, channel, address, status, account_id) on mail_sources to iam_auth_reader;
grant select (id, organization_id, recovery_email_alias) on accounts to iam_auth_reader;

create policy mail_sources_auth_lookup on mail_sources for select to iam_auth_reader using (true);
create policy accounts_alias_guard_lookup on accounts for select to iam_auth_reader using (true);

-- Resolución ------------------------------------------------------------------------------
-- Devuelve organización, fuente, canal y estado de la dirección EXACTA. Archivada = inexistente
-- (mismo resultado vacío). Suspendida sí se devuelve con su estado para que quien llama la descarte
-- sin hacer otra consulta. La dirección es dato del atacante: se compara tal cual tras pasarla a
-- minúsculas, sin comodines ni coincidencias parciales.
create function auth.resolve_inbound_address(p_channel text, p_address text)
  returns table (organization_id uuid, source_id uuid, channel text, status text)
  language sql stable security definer
  set search_path = pg_catalog
as $$
  select s.organization_id, s.id, s.channel, s.status
  from public.mail_sources s
  where s.channel = p_channel
    and s.address = lower(p_address)
    and s.status <> 'archived'
$$;

-- Guardia de alias --------------------------------------------------------------------------
-- El mensaje de error no repite la dirección ni dice en qué organización está el conflicto.
create function auth.mail_sources_alias_guard()
  returns trigger
  language plpgsql security definer
  set search_path = pg_catalog
as $$
begin
  if new.channel = 'mail' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('inbound-address:' || new.address, 0));
    if exists (
      select 1
      from public.accounts a
      where a.recovery_email_alias = new.address
        and a.id is distinct from new.account_id
    ) then
      raise exception 'inbound address conflict' using errcode = '23505';
    end if;
  end if;
  return new;
end
$$;

create function auth.accounts_alias_guard()
  returns trigger
  language plpgsql security definer
  set search_path = pg_catalog
as $$
begin
  if new.recovery_email_alias is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('inbound-address:' || new.recovery_email_alias, 0));
    if exists (
      select 1
      from public.mail_sources s
      where s.channel = 'mail'
        and s.address = new.recovery_email_alias
        and s.account_id is distinct from new.id
    ) then
      raise exception 'inbound address conflict' using errcode = '23505';
    end if;
  end if;
  return new;
end
$$;

alter function auth.resolve_inbound_address(text, text) owner to iam_auth_reader;
alter function auth.mail_sources_alias_guard() owner to iam_auth_reader;
alter function auth.accounts_alias_guard() owner to iam_auth_reader;

revoke all on function auth.resolve_inbound_address(text, text) from public;
revoke all on function auth.mail_sources_alias_guard() from public;
revoke all on function auth.accounts_alias_guard() from public;
grant execute on function auth.resolve_inbound_address(text, text) to iam_app, iam_inbound_worker;

-- `address`, `channel` y `account_id` son los únicos datos que la guardia compara; `address` y
-- `channel` ya son inmutables por permisos, `account_id` sí se puede cambiar.
create trigger mail_sources_alias_guard
  before insert or update of address, channel, account_id on mail_sources
  for each row execute function auth.mail_sources_alias_guard();
create trigger accounts_alias_guard
  before insert or update of recovery_email_alias on accounts
  for each row execute function auth.accounts_alias_guard();

-- Rol del worker ----------------------------------------------------------------------------
grant usage on schema auth to iam_inbound_worker;
grant execute on function uuid_generate_v7() to iam_inbound_worker;

-- Lee solo lo necesario para decidir y extraer. Sin `display_name`, sin `created_by`, sin nada de
-- las comparticiones ni de las cuentas.
grant select (id, organization_id, channel, address, status, account_id) on mail_sources to iam_inbound_worker;
grant select (id, organization_id, kind, definition, archived_at) on inbound_templates to iam_inbound_worker;
grant select (id, organization_id, source_id, archived_at) on mail_views to iam_inbound_worker;
grant select (organization_id, view_id, template_id) on mail_view_templates to iam_inbound_worker;

-- Escribe el resultado. Nunca lee el valor cifrado de vuelta (solo ve ids) y nunca actualiza ni borra.
grant insert on inbound_items to iam_inbound_worker;
grant select (id, organization_id, source_id) on inbound_items to iam_inbound_worker;
grant insert on inbound_receipts to iam_inbound_worker;
grant select (id, organization_id, source_id, message_fingerprint, outcome) on inbound_receipts to iam_inbound_worker;
