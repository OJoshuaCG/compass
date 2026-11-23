-- 0047: auditoría de plataforma (ADR 0052, opción C) y rotación de claves de firma OIDC auditada.
--
-- Hasta ahora alta y retiro de claves de firma solo dejaban una línea JSON en la consola (decisión del dueño,
-- 2026-11-20, opción A), válida mientras SSO siguiera apagado. Esta migración la reemplaza: cada alta y cada
-- retiro escriben su fila en `platform_audit_events` EN LA MISMA SENTENCIA que cambia la clave. Si la fila no
-- se puede escribir (por ejemplo, sin actor), la clave no se crea ni se retira: la auditoría falla cerrada.
--
-- `audit_events` no sirve para esto: exige organización y el emisor OIDC es uno solo (ADR 0052). Por eso esta es
-- la SEGUNDA tabla sin organización de la base de datos (la primera es `oidc_signing_keys`). Se sustituye el
-- aislamiento por organización por dos cosas: la aplicación (`iam_app`) no tiene ningún privilegio sobre la
-- tabla, y la tabla es de solo agregar (ni el administrador puede modificar, borrar ni truncar).
--
-- Se eliminan las funciones auth.add_oidc_signing_key/4 y auth.retire_oidc_signing_key/1 de la migración 0045
-- (no se edita esa migración): dejarlas sería una vía para rotar claves sin auditar.

-- platform_audit_events ---------------------------------------------------------------------------------------
create table platform_audit_events (
  id          uuid primary key default uuid_generate_v7(),
  event_type  text not null check (event_type in ('oidc_signing_key.added', 'oidc_signing_key.retired')),
  subject     text not null check (char_length(subject) between 1 and 128),
  details     jsonb not null default '{}'::jsonb,
  actor       text not null check (char_length(actor) between 1 and 200),
  occurred_at timestamptz not null default now()
);
comment on table platform_audit_events is
  'Auditoría de acciones de plataforma que no pertenecen a una organización (hoy, claves de firma OIDC). Solo se agrega: nunca se modifica ni se borra. Sin organización por diseño (ADR 0052).';
comment on column platform_audit_events.event_type is
  'Qué ocurrió. Cada tipo nuevo exige una migración que amplíe el CHECK.';
comment on column platform_audit_events.subject is
  'Sobre qué ocurrió: el kid de la clave de firma. Es un identificador público, nunca material de clave.';
comment on column platform_audit_events.details is
  'Datos no secretos del evento (hoy, el algoritmo de la clave). Nunca claves, sobres cifrados ni credenciales.';
comment on column platform_audit_events.actor is
  'Quién lo hizo: `os:<usuario del sistema operativo>` para el comando de operación, `system:api-process` para la clave inicial que crea el arranque de la API.';
comment on column platform_audit_events.occurred_at is
  'Hora UTC del servidor de base de datos, no la del cliente: el cliente no la puede falsear.';

create index platform_audit_events_occurred_at on platform_audit_events (occurred_at desc);

alter table platform_audit_events enable row level security;
alter table platform_audit_events force row level security;
-- Sin política para `iam_app`: aunque alguien le diera un GRANT vería cero filas. Solo el dueño de las funciones
-- de abajo (`iam_auth_reader`) escribe y lee.
create policy platform_audit_events_writer_insert on platform_audit_events
  for insert to iam_auth_reader with check (true);
create policy platform_audit_events_reader_select on platform_audit_events
  for select to iam_auth_reader using (true);

grant select, insert on platform_audit_events to iam_auth_reader;

-- Solo agregar: el trigger protege también frente al administrador y al dueño de la tabla, que no pasan por
-- los privilegios. Quitarlo exige un DROP TRIGGER que queda en los registros de la base de datos.
create function platform_audit_events_forbid_change() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
begin
  raise exception 'platform_audit_events is append-only (% is not allowed)', tg_op;
end
$$;

create trigger platform_audit_events_no_row_change
  before update or delete on platform_audit_events
  for each row execute function platform_audit_events_forbid_change();
create trigger platform_audit_events_no_truncate
  before truncate on platform_audit_events
  for each statement execute function platform_audit_events_forbid_change();

-- Claves de firma: alta y retiro auditados -----------------------------------------------------------------------
drop function auth.add_oidc_signing_key(text, text, jsonb, bytea);
drop function auth.retire_oidc_signing_key(text);

-- Parámetros: p_kid, p_alg, p_public_jwk y p_private_jwk_ciphertext describen la clave (el sobre ya viene cifrado);
-- p_actor es quien la añade (no puede ser nulo ni vacío).
-- Efectos: inserta la clave y su fila de auditoría en una sola sentencia; si cualquiera falla, no queda ninguna.
create function auth.add_oidc_signing_key(
  p_kid text,
  p_alg text,
  p_public_jwk jsonb,
  p_private_jwk_ciphertext bytea,
  p_actor text
)
  returns void
  language sql volatile security definer
  set search_path = pg_catalog
as $$
  with added as (
    insert into public.oidc_signing_keys (kid, alg, public_jwk, private_jwk_ciphertext)
    values (p_kid, p_alg, p_public_jwk, p_private_jwk_ciphertext)
    returning kid, alg
  )
  insert into public.platform_audit_events (event_type, subject, details, actor)
  select 'oidc_signing_key.added', added.kid, jsonb_build_object('alg', added.alg), p_actor
  from added
$$;

-- Parámetros: p_kid es la clave a retirar; p_actor, quien la retira.
-- Devuelve true si la retiró y false si no existía o ya estaba retirada (en ese caso no escribe auditoría).
-- Efectos: el retiro y su fila de auditoría ocurren en una sola sentencia. No comprueba que quede otra clave
-- activa: eso lo hace SigningKeyService (seguimiento conocido de L30, necesita una decisión sobre criptografía).
create function auth.retire_oidc_signing_key(p_kid text, p_actor text)
  returns boolean
  language sql volatile security definer
  set search_path = pg_catalog
as $$
  with retired as (
    update public.oidc_signing_keys
       set status = 'retired', retired_at = now()
     where kid = p_kid and status = 'active'
    returning kid, alg
  ),
  audited as (
    insert into public.platform_audit_events (event_type, subject, details, actor)
    select 'oidc_signing_key.retired', retired.kid, jsonb_build_object('alg', retired.alg), p_actor
    from retired
    returning 1
  )
  select exists (select 1 from audited)
$$;

alter function auth.add_oidc_signing_key(text, text, jsonb, bytea, text) owner to iam_auth_reader;
alter function auth.retire_oidc_signing_key(text, text) owner to iam_auth_reader;

revoke all on function auth.add_oidc_signing_key(text, text, jsonb, bytea, text) from public;
revoke all on function auth.retire_oidc_signing_key(text, text) from public;
grant execute on function auth.add_oidc_signing_key(text, text, jsonb, bytea, text) to iam_app;
grant execute on function auth.retire_oidc_signing_key(text, text) to iam_app;
