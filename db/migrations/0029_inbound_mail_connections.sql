-- 0029: conexión IMAP de las fuentes de correo y estado del sondeo (ADR 0045, IC-3a).
--
-- Dos tablas nuevas, cada una con organización, índice que empieza por ella y política de aislamiento
-- por filas en esta misma migración:
--  * `mail_source_connections`: cómo llega el worker al buzón (servidor, usuario, modo TLS, destinatarios
--    aceptados) y la contraseña cifrada por el módulo de criptografía.
--  * `mail_source_poll_state`: cursor del buzón, arrendamiento y retroceso por fallos del sondeo.
--
-- Decisiones de privilegios (ver ADR 0045, "Diseño de IC-3 por IMAP"):
--  * El worker (`iam_inbound_worker`) lee la contraseña cifrada: es la única excepción a "el worker nunca
--    lee valores cifrados" y la hace necesaria el propio sondeo. Sigue sin poder escribir la conexión,
--    sin crear llaves (no tiene escritura sobre `data_keys`) y sin tocar recibos ni elementos más allá
--    de lo que le dio la 0025.
--  * La API (`iam_app`) escribe la conexión y puede leer y reemplazar la contraseña cifrada: el recifrado
--    por rotación de DEK (ADR 0040) lo necesita; sin él, la DEK anterior no se podría retirar.
--  * Límites que la base NO impone: (a) que `password_ciphertext` salga del módulo de criptografía (solo
--    se exige largo mínimo); (b) que el worker fije en `app.org_id` la organización que resolvió, igual
--    que con la 0025.
--
-- Prerrequisito: el rol `iam_inbound_worker` lo crea `bootstrapRoles()` (ya exigido por la 0025).

-- mail_source_connections -------------------------------------------------------------------
create table mail_source_connections (
  organization_id     uuid not null references organizations (id),
  source_id           uuid not null,
  host                text not null check (length(host) between 1 and 253 and host = lower(host)),
  port                integer not null check (port between 1 and 65535),
  username            text not null check (length(btrim(username)) between 1 and 320),
  -- 'tls' = TLS implícito (puerto 993); 'starttls' = STARTTLS forzado (puerto 143). Nunca texto plano.
  tls_mode            text not null check (tls_mode in ('tls', 'starttls')),
  -- Valor de `authserv-id` de la cabecera `Authentication-Results` que antepone el servidor propio.
  authserv_id         text not null check (length(authserv_id) between 1 and 253),
  -- Direcciones que el encabezado `To` puede traer cuando al buzón se reenvía correo (el IC-1 exige un
  -- solo `To` firmado que pertenezca al conjunto). Exactas, en minúsculas, entre 1 y 10; el dominio
  -- valida el formato, la base cubre lo estructural.
  accepted_recipients text[] not null check (
    cardinality(accepted_recipients) between 1 and 10
    and array_position(accepted_recipients, null) is null
    and array_to_string(accepted_recipients, ',') = lower(array_to_string(accepted_recipients, ','))
    and length(array_to_string(accepted_recipients, ',')) <= 3200
  ),
  -- Contraseña cifrada. Nula (las tres columnas a la vez) cuando se cambió el servidor, el puerto, el
  -- usuario o el modo TLS: obliga a reintroducirla y la fuente deja de sondearse mientras tanto.
  password_ciphertext bytea check (password_ciphertext is null or octet_length(password_ciphertext) >= 16),
  password_nonce      bytea check (password_nonce is null or octet_length(password_nonce) = 12),
  dek_version         integer check (dek_version is null or dek_version > 0),
  -- Versión del secreto dentro de su contexto de cifrado (AAD): sube cada vez que se reintroduce.
  secret_version      integer not null default 1 check (secret_version > 0),
  created_by          uuid not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  version             integer not null default 1,
  primary key (organization_id, source_id),
  constraint mail_source_connections_password_complete check (
    (password_ciphertext is null) = (password_nonce is null)
    and (password_ciphertext is null) = (dek_version is null)
  ),
  foreign key (organization_id, source_id) references mail_sources (organization_id, id),
  foreign key (organization_id, created_by) references users (organization_id, id),
  foreign key (organization_id, dek_version) references data_keys (organization_id, version)
);
comment on table mail_source_connections is 'Conexión IMAP de una fuente de correo; una por fuente. La contraseña va cifrada (ADR 0045).';
comment on column mail_source_connections.tls_mode is 'tls = TLS implícito; starttls = STARTTLS forzado. Nunca texto plano.';
comment on column mail_source_connections.authserv_id is 'authserv-id esperado en la primera Authentication-Results del mensaje.';
comment on column mail_source_connections.accepted_recipients is 'Direcciones exactas aceptadas en el To firmado (buzón con reenvío); 1 a 10.';
comment on column mail_source_connections.secret_version is 'Versión del secreto dentro del contexto de cifrado (AAD); sube al reintroducir la contraseña.';
create index mail_source_connections_dek on mail_source_connections (organization_id, dek_version)
  where dek_version is not null;
create trigger mail_source_connections_touch before update on mail_source_connections
  for each row execute function touch_updated_at();

-- mail_source_poll_state --------------------------------------------------------------------
create table mail_source_poll_state (
  organization_id      uuid not null references organizations (id),
  source_id            uuid not null,
  -- UIDVALIDITY y último UID procesado: enteros de 32 bits sin signo, por eso bigint.
  uid_validity         bigint check (uid_validity is null or uid_validity between 0 and 4294967295),
  last_uid             bigint not null default 0 check (last_uid between 0 and 4294967295),
  last_polled_at       timestamptz,
  -- Arrendamiento: una pasada reclama la fuente hasta esta hora; si el proceso muere, vence solo.
  claimed_until        timestamptz,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  next_attempt_at      timestamptz not null default now(),
  -- Código acotado del último fallo (nunca el texto del servidor ni el host).
  last_error_code      text check (last_error_code is null or last_error_code ~ '^[A-Z_.]{1,64}$'),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (organization_id, source_id),
  foreign key (organization_id, source_id) references mail_sources (organization_id, id)
);
comment on table mail_source_poll_state is 'Cursor, arrendamiento y retroceso del sondeo IMAP de una fuente. Sin secretos.';
comment on column mail_source_poll_state.claimed_until is 'Arrendamiento de la pasada en curso; vencido o nulo = libre.';
comment on column mail_source_poll_state.next_attempt_at is 'No se sondea antes de esta hora (retroceso exponencial con tope de 1 hora).';
create index mail_source_poll_state_due on mail_source_poll_state (organization_id, next_attempt_at);
create trigger mail_source_poll_state_touch before update on mail_source_poll_state
  for each row execute function touch_updated_at();

-- Aislamiento por filas -----------------------------------------------------------------------
alter table mail_source_connections enable row level security;
alter table mail_source_connections force row level security;
create policy mail_source_connections_tenant_isolation on mail_source_connections for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);

alter table mail_source_poll_state enable row level security;
alter table mail_source_poll_state force row level security;
create policy mail_source_poll_state_tenant_isolation on mail_source_poll_state for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);

-- API (iam_app) -------------------------------------------------------------------------------
-- Sin `organization_id`, `source_id` ni `created_by` en el UPDATE: la conexión pertenece a su fuente.
grant select, insert, update (
  host, port, username, tls_mode, authserv_id, accepted_recipients,
  password_ciphertext, password_nonce, dek_version, secret_version, version, updated_at
) on mail_source_connections to iam_app;
-- Lee el estado para mostrarlo; la purga lo borra cuando la fuente se archiva. Nunca lo escribe.
grant select, delete on mail_source_poll_state to iam_app;

-- Worker (iam_inbound_worker) -------------------------------------------------------------------
grant select (
  organization_id, source_id, host, port, username, tls_mode, authserv_id, accepted_recipients,
  password_ciphertext, password_nonce, dek_version, secret_version
) on mail_source_connections to iam_inbound_worker;
-- Única tabla donde el worker actualiza. El cursor y el arrendamiento son suyos; no hay borrado.
grant select, insert, update (
  uid_validity, last_uid, last_polled_at, claimed_until, consecutive_failures, next_attempt_at,
  last_error_code, updated_at
) on mail_source_poll_state to iam_inbound_worker;
-- Para abrir la DEK con el KMS: material envuelto de solo lectura. No inserta ni actualiza llaves.
grant select (organization_id, version, wrapped_dek, kms_key_ref, status) on data_keys to iam_inbound_worker;

-- Listado de fuentes sondeables -------------------------------------------------------------------
-- Primera función `auth.*` que enumera para un rol distinto de la API (precedente: 0014). Devuelve solo
-- pares accionables: fuentes de correo activas, con conexión y contraseña, vencidas por
-- `next_attempt_at` y sin arrendamiento vigente. Una fuente nueva no tiene fila de estado (LEFT JOIN).
-- Solo ve columnas no secretas: `password_nonce is not null` basta para saber que hay contraseña.
grant select (organization_id, source_id, password_nonce) on mail_source_connections to iam_auth_reader;
grant select (organization_id, source_id, next_attempt_at, claimed_until) on mail_source_poll_state to iam_auth_reader;
create policy mail_source_connections_auth_lookup on mail_source_connections for select to iam_auth_reader using (true);
create policy mail_source_poll_state_auth_lookup on mail_source_poll_state for select to iam_auth_reader using (true);

create function auth.list_pollable_inbound_sources()
  returns table (organization_id uuid, source_id uuid)
  language sql stable security definer
  set search_path = pg_catalog
as $$
  select s.organization_id, s.id
  from public.mail_sources s
  join public.mail_source_connections c
    on c.organization_id = s.organization_id
   and c.source_id = s.id
  left join public.mail_source_poll_state p
    on p.organization_id = s.organization_id
   and p.source_id = s.id
  where s.channel = 'mail'
    and s.status = 'active'
    and c.password_nonce is not null
    and (p.next_attempt_at is null or p.next_attempt_at <= pg_catalog.now())
    and (p.claimed_until is null or p.claimed_until < pg_catalog.now())
  order by p.next_attempt_at nulls first, s.id
$$;

alter function auth.list_pollable_inbound_sources() owner to iam_auth_reader;
revoke all on function auth.list_pollable_inbound_sources() from public;
grant execute on function auth.list_pollable_inbound_sources() to iam_inbound_worker;
