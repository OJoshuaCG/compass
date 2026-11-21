-- 0045: proveedor OIDC (fase 2; ADR 0050, 0051 y 0052; tarea T3 de `odd/tasks/phase-2-oidc-sso.md`).
--
-- Tablas nuevas:
--  * `oidc_clients`: aplicaciones que usan a Compass como login. Las registra la Raíz.
--  * `oidc_payloads`: almacenamiento del paquete `oidc-provider` (sesión propia del paquete, concesiones,
--    códigos, tokens e interacciones), ligado a la sesión de Compass (ADR 0051).
--  * `oidc_signing_keys`: claves con que se firman los tokens. Es la ÚNICA tabla sin organización (ADR 0052,
--    decisión 2A): el emisor es uno solo. Ningún rol de la aplicación la toca directamente.
--
-- Qué hace además:
--  * `sessions` gana la restricción única (organization_id, id) para poder ligar filas con una clave
--    foránea compuesta, de modo que una concesión nunca apunte a una sesión de otra organización.
--  * Tres funciones de SOLO LECTURA en el esquema `auth` (patrón del ADR 0021) que resuelven la organización
--    antes de que exista contexto: por `client_id`, por el hash de un identificador y por `uid`. Cada una
--    recibe una sola clave exacta y devuelve solo la organización. Resuelta esta, todas las escrituras
--    van bajo el aislamiento por filas normal.
--  * Tres funciones para las claves de firma (listar vigentes, añadir, retirar), con EXECUTE solo para
--    `iam_app`. Son el único camino a `oidc_signing_keys`.
--
-- Qué NO hace:
--  * No crea claves ni clientes. No escribe auditoría (la escribe la aplicación en su transacción).
--  * No toca datos existentes.

alter table sessions add constraint sessions_org_id_unique unique (organization_id, id);

-- oidc_clients ---------------------------------------------------------------------------------------------
create table oidc_clients (
  id                                uuid primary key default uuid_generate_v7(),
  organization_id                   uuid not null references organizations (id),
  client_id                         text not null unique check (client_id ~ '^[A-Za-z0-9._~-]{8,64}$'),
  name                              text not null check (char_length(name) between 1 and 80),
  secret_ciphertext                 bytea not null,
  redirect_uris                     text[] not null check (cardinality(redirect_uris) between 1 and 10),
  post_logout_redirect_uris         text[] not null default '{}' check (cardinality(post_logout_redirect_uris) <= 10),
  backchannel_logout_uri            text check (backchannel_logout_uri is null or backchannel_logout_uri ~ '^https?://'),
  allow_private_network_backchannel boolean not null default false,
  allow_refresh_tokens              boolean not null default false,
  refresh_justification             text check (refresh_justification is null or char_length(refresh_justification) between 10 and 500),
  is_external                       boolean not null default false,
  max_rank                          smallint check (max_rank is null or max_rank between 0 and 3),
  status                            text not null default 'active' check (status in ('active', 'disabled')),
  created_by                        uuid not null,
  created_at                        timestamptz not null default now(),
  disabled_at                       timestamptz,
  constraint oidc_clients_refresh_needs_justification
    check (not allow_refresh_tokens or refresh_justification is not null),
  constraint oidc_clients_disabled_has_date check ((status = 'disabled') = (disabled_at is not null)),
  foreign key (organization_id, created_by) references users (organization_id, id)
);
comment on table oidc_clients is
  'Aplicaciones que usan a Compass como proveedor de inicio de sesión (OIDC). Las registra la Raíz; ADR 0052.';
comment on column oidc_clients.client_id is 'Identificador público del cliente; único en toda la plataforma porque la organización se resuelve desde él.';
comment on column oidc_clients.secret_ciphertext is 'Secreto del cliente cifrado por el módulo de criptografía; el paquete necesita el valor en claro para compararlo, por eso no es un hash.';
comment on column oidc_clients.redirect_uris is 'Direcciones de retorno permitidas; coincidencia exacta, sin comodines.';
comment on column oidc_clients.allow_private_network_backchannel is 'Si es falso, el aviso de cierre a este cliente no se envía a IP privadas ni loopback (ADR 0050, protección contra SSRF).';
comment on column oidc_clients.allow_refresh_tokens is 'Solo si el cliente lo justifica por escrito (ADR 0051, D3).';
comment on column oidc_clients.is_external is 'Si es verdadero se muestra pantalla de consentimiento; los clientes internos no la muestran (ADR 0052, decisión 4A).';
comment on column oidc_clients.max_rank is 'Rango numérico máximo que puede entrar (0 Raíz ... 3 Operador); nulo = cualquier persona activa de la organización.';

create index oidc_clients_org_status on oidc_clients (organization_id, status);

alter table oidc_clients enable row level security;
alter table oidc_clients force row level security;
create policy oidc_clients_tenant_isolation on oidc_clients for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
-- Sin DELETE: un cliente se deshabilita para conservar el rastro de auditoría.
grant select, insert, update on oidc_clients to iam_app;

-- oidc_payloads --------------------------------------------------------------------------------------------
create table oidc_payloads (
  id                uuid primary key default uuid_generate_v7(),
  organization_id   uuid not null references organizations (id),
  model             text not null check (model in
                      ('Session', 'AccessToken', 'AuthorizationCode', 'RefreshToken', 'Grant', 'Interaction', 'ReplayDetection')),
  key_hash          bytea not null check (octet_length(key_hash) = 32),
  payload           jsonb not null,
  grant_id          text,
  uid               text,
  user_id           uuid,
  compass_session_id uuid,
  expires_at        timestamptz not null,
  consumed_at       timestamptz,
  created_at        timestamptz not null default now(),
  constraint oidc_payloads_model_key_unique unique (model, key_hash),
  foreign key (organization_id, user_id) references users (organization_id, id),
  foreign key (organization_id, compass_session_id) references sessions (organization_id, id)
);
comment on table oidc_payloads is
  'Almacenamiento del paquete oidc-provider. Cada fila con concesión apunta a la sesión de Compass de la que nace; ADR 0051 y 0052.';
comment on column oidc_payloads.key_hash is 'SHA-256 del identificador del paquete (token, código o uid de sesión); el valor en claro nunca se guarda.';
comment on column oidc_payloads.payload is 'Contenido del paquete sin el campo jti, que se reconstruye al leer.';
comment on column oidc_payloads.grant_id is 'Identificador de la concesión del paquete; sirve para revocar en bloque.';
comment on column oidc_payloads.compass_session_id is 'Sesión de Compass de la que nace la fila; al cerrarse esa sesión se borran estas filas.';
comment on column oidc_payloads.expires_at is 'Vencimiento ya recortado a expires_at de la sesión de Compass (ADR 0051, punto 4).';

create index oidc_payloads_org_grant on oidc_payloads (organization_id, grant_id) where grant_id is not null;
create index oidc_payloads_org_session on oidc_payloads (organization_id, compass_session_id) where compass_session_id is not null;
create index oidc_payloads_org_user on oidc_payloads (organization_id, user_id) where user_id is not null;
create index oidc_payloads_uid on oidc_payloads (model, uid) where uid is not null;
create index oidc_payloads_expires on oidc_payloads (expires_at);

alter table oidc_payloads enable row level security;
alter table oidc_payloads force row level security;
create policy oidc_payloads_tenant_isolation on oidc_payloads for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
-- Con DELETE: son datos efímeros con vencimiento y la revocación en cascada los borra.
grant select, insert, update, delete on oidc_payloads to iam_app;

-- oidc_signing_keys ----------------------------------------------------------------------------------------
-- Tabla de plataforma, sin organización (ADR 0052, decisión 2A). El aislamiento por filas se mantiene
-- activo y SIN política para `iam_app`, de modo que aunque alguien le diera un GRANT vería cero filas;
-- solo las funciones de abajo, que pertenecen a `iam_auth_reader`, llegan a ella.
create table oidc_signing_keys (
  id                     uuid primary key default uuid_generate_v7(),
  kid                    text not null unique check (char_length(kid) between 8 and 64),
  alg                    text not null check (alg in ('ES256', 'RS256')),
  public_jwk             jsonb not null,
  private_jwk_ciphertext bytea not null,
  status                 text not null default 'active' check (status in ('active', 'retired')),
  created_at             timestamptz not null default now(),
  retired_at             timestamptz,
  constraint oidc_signing_keys_retired_has_date check ((status = 'retired') = (retired_at is not null))
);
comment on table oidc_signing_keys is
  'Claves de firma de tokens del emisor único. Sin organización por diseño (ADR 0052). La clave privada va cifrada con la clave de plataforma.';
comment on column oidc_signing_keys.status is 'active = firma y publica; retired = ya no firma ni se publica (los tokens firmados con ella dejan de validarse).';

alter table oidc_signing_keys enable row level security;
alter table oidc_signing_keys force row level security;
create policy oidc_signing_keys_key_reader on oidc_signing_keys for all to iam_auth_reader using (true) with check (true);

grant select (kid, alg, public_jwk, private_jwk_ciphertext, status, created_at) on oidc_signing_keys to iam_auth_reader;
grant insert (kid, alg, public_jwk, private_jwk_ciphertext) on oidc_signing_keys to iam_auth_reader;
grant update (status, retired_at) on oidc_signing_keys to iam_auth_reader;
-- Para el UPDATE ... WHERE kid = $1 el rol necesita leer `kid` (ya concedido arriba).

-- Funciones de solo lectura para resolver la organización (patrón del ADR 0021) ------------------------------
grant select (organization_id, client_id, status) on oidc_clients to iam_auth_reader;
grant select (organization_id, model, key_hash, uid, expires_at) on oidc_payloads to iam_auth_reader;
create policy oidc_clients_auth_lookup on oidc_clients for select to iam_auth_reader using (true);
create policy oidc_payloads_auth_lookup on oidc_payloads for select to iam_auth_reader using (true);

create function auth.find_oidc_client_org(p_client_id text)
  returns table (organization_id uuid, status text)
  language sql stable security definer
  set search_path = pg_catalog
as $$
  select c.organization_id, c.status
  from public.oidc_clients c
  where c.client_id = p_client_id
$$;

create function auth.find_oidc_payload_org(p_model text, p_key_hash bytea)
  returns table (organization_id uuid)
  language sql stable security definer
  set search_path = pg_catalog
as $$
  select p.organization_id
  from public.oidc_payloads p
  where p.model = p_model and p.key_hash = p_key_hash and p.expires_at > now()
$$;

create function auth.find_oidc_payload_org_by_uid(p_model text, p_uid text)
  returns table (organization_id uuid)
  language sql stable security definer
  set search_path = pg_catalog
as $$
  select p.organization_id
  from public.oidc_payloads p
  where p.model = p_model and p.uid = p_uid and p.expires_at > now()
$$;

-- Claves de firma: listar las vigentes, añadir y retirar ---------------------------------------------------
create function auth.list_oidc_signing_keys()
  returns table (kid text, alg text, public_jwk jsonb, private_jwk_ciphertext bytea)
  language sql stable security definer
  set search_path = pg_catalog
as $$
  select k.kid, k.alg, k.public_jwk, k.private_jwk_ciphertext
  from public.oidc_signing_keys k
  where k.status = 'active'
  order by k.created_at, k.kid
$$;

create function auth.add_oidc_signing_key(p_kid text, p_alg text, p_public_jwk jsonb, p_private_jwk_ciphertext bytea)
  returns void
  language sql volatile security definer
  set search_path = pg_catalog
as $$
  insert into public.oidc_signing_keys (kid, alg, public_jwk, private_jwk_ciphertext)
  values (p_kid, p_alg, p_public_jwk, p_private_jwk_ciphertext)
$$;

create function auth.retire_oidc_signing_key(p_kid text)
  returns boolean
  language sql volatile security definer
  set search_path = pg_catalog
as $$
  with retired as (
    update public.oidc_signing_keys
       set status = 'retired', retired_at = now()
     where kid = p_kid and status = 'active'
    returning 1
  )
  select exists (select 1 from retired)
$$;

alter function auth.find_oidc_client_org(text) owner to iam_auth_reader;
alter function auth.find_oidc_payload_org(text, bytea) owner to iam_auth_reader;
alter function auth.find_oidc_payload_org_by_uid(text, text) owner to iam_auth_reader;
alter function auth.list_oidc_signing_keys() owner to iam_auth_reader;
alter function auth.add_oidc_signing_key(text, text, jsonb, bytea) owner to iam_auth_reader;
alter function auth.retire_oidc_signing_key(text) owner to iam_auth_reader;

revoke all on function auth.find_oidc_client_org(text) from public;
revoke all on function auth.find_oidc_payload_org(text, bytea) from public;
revoke all on function auth.find_oidc_payload_org_by_uid(text, text) from public;
revoke all on function auth.list_oidc_signing_keys() from public;
revoke all on function auth.add_oidc_signing_key(text, text, jsonb, bytea) from public;
revoke all on function auth.retire_oidc_signing_key(text) from public;
grant execute on function auth.find_oidc_client_org(text) to iam_app;
grant execute on function auth.find_oidc_payload_org(text, bytea) to iam_app;
grant execute on function auth.find_oidc_payload_org_by_uid(text, text) to iam_app;
grant execute on function auth.list_oidc_signing_keys() to iam_app;
grant execute on function auth.add_oidc_signing_key(text, text, jsonb, bytea) to iam_app;
grant execute on function auth.retire_oidc_signing_key(text) to iam_app;
