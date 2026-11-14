-- 0040: vista previa transitoria de un correo del buzón real (ADR 0045, enmienda 2026-11-10;
-- odd/tasks/inbound-mail-delete.md, S6, L9 a L11).
--
-- Una persona que no encuentra su código necesita ver el asunto (para confirmar qué correo es antes de
-- borrarlo) y, bajo las condiciones de `inbound.reveal_reset`, el cuerpo. La API NUNCA habla con el buzón ni
-- descifra su contraseña: registra aquí una petición ya autorizada y el worker de sondeo, que sí maneja la
-- contraseña, trae el mensaje por su UID, lo cifra y deja el resultado en la misma fila. La API lo descifra
-- al entregarlo y borra la fila en ese momento.
--
-- Enmienda de S4 («no se guarda ningún correo»): el asunto o el cuerpo existen en la base SOLO de forma
-- transitoria y cifrados, hasta 15 minutos (`expires_at`) o hasta que se entregan, lo que ocurra primero.
-- Lo vencido nunca se entrega aunque la purga no haya corrido; la purga la hace el worker.
--
-- Decisiones:
--  * Tabla aparte de `mail_delete_requests`: aquella es un registro operativo sin contenido y sin borrado; esta
--    guarda contenido cifrado y se borra. Mezclarlas habría dado a la fila de borrado un campo sensible.
--  * La petición COPIA la posición del recibo (UIDVALIDITY y UID); el worker compara el UIDVALIDITY con el del
--    buzón antes de descargar nada, así que un UID viejo nunca apunta a otro mensaje.
--  * `expires_at` nace con la petición (el plazo de espera del worker) y el worker lo reinicia al dejar el
--    contenido, de modo que los 15 minutos cuentan desde que el contenido existe. Una sola regla de purga.
--  * El campo de cifrado (AAD) es propio (`mail_preview`) y el id de la fila forma parte del AAD: copiar el
--    texto cifrado a otra fila u organización hace fallar el descifrado.
--  * Una sola petición viva por recibo y clase (índice único parcial); una fallida no bloquea volver a pedir.
--  * Sin llave foránea al recibo, por la misma razón que en la 0038 (la purga del historial no se bloquea).
--  * El worker no escribe auditoría: la API audita al pedir y, para el cuerpo, de forma crítica al ENTREGAR.

create table mail_preview_requests (
  id                   uuid primary key default uuid_generate_v7(),
  organization_id      uuid not null references organizations (id),
  source_id            uuid not null,
  receipt_id           uuid not null,
  mailbox_uid_validity bigint not null check (mailbox_uid_validity between 0 and 4294967295),
  mailbox_uid          bigint not null check (mailbox_uid between 1 and 4294967295),
  kind                 text not null check (kind in ('subject', 'body')),
  requested_by         uuid not null,
  requested_at         timestamptz not null default now(),
  status               text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  -- Resultado acotado: READY, NOT_FOUND, POSITION_CHANGED, CONNECTION, CONNECTION_MISSING, TOO_LARGE, EMPTY, UNEXPECTED.
  result_code          text check (result_code is null or result_code ~ '^[A-Z_]{1,64}$'),
  completed_at         timestamptz,
  ciphertext           bytea check (ciphertext is null or octet_length(ciphertext) between 16 and 262144),
  nonce                bytea check (nonce is null or octet_length(nonce) = 12),
  dek_version          integer check (dek_version is null or dek_version > 0),
  expires_at           timestamptz not null,
  constraint mail_preview_requests_state_consistent check (
    (status = 'pending' and result_code is null and completed_at is null
       and ciphertext is null and nonce is null and dek_version is null)
    or (status = 'ready' and result_code is not null and completed_at is not null
       and ciphertext is not null and nonce is not null and dek_version is not null)
    or (status = 'failed' and result_code is not null and completed_at is not null
       and ciphertext is null and nonce is null and dek_version is null)
  ),
  unique (organization_id, id),
  foreign key (organization_id, source_id) references mail_sources (organization_id, id),
  foreign key (organization_id, requested_by) references users (organization_id, id),
  foreign key (organization_id, dek_version) references data_keys (organization_id, version)
);
comment on table mail_preview_requests is
  'Vista previa transitoria (asunto o cuerpo) de un correo del buzón real. La API pide; el worker trae y cifra; la API descifra al entregar y borra la fila. Nada vive más de expires_at.';
comment on column mail_preview_requests.receipt_id is 'Recibo del mensaje; sin llave foránea para que la purga del historial no se bloquee.';
comment on column mail_preview_requests.mailbox_uid_validity is 'UIDVALIDITY copiado del recibo; si el buzón ya tiene otro, no se descarga nada.';
comment on column mail_preview_requests.mailbox_uid is 'UID copiado del recibo al pedir la vista previa.';
comment on column mail_preview_requests.kind is 'subject = solo el asunto; body = el cuerpo completo en texto plano (exige las condiciones de inbound.reveal_reset).';
comment on column mail_preview_requests.status is 'pending = esperando al worker; ready = contenido cifrado listo para entregar; failed = no se pudo traer (ver result_code).';
comment on column mail_preview_requests.result_code is 'Resultado acotado del worker; nunca texto del servidor.';
comment on column mail_preview_requests.ciphertext is 'Asunto o cuerpo cifrado por el módulo de criptografía (campo mail_preview); nulo hasta que el worker lo deja.';
comment on column mail_preview_requests.expires_at is 'Límite de vida de la fila y de su contenido; lo vencido nunca se entrega y el worker lo purga.';

create unique index mail_preview_requests_one_live_per_receipt_kind
  on mail_preview_requests (organization_id, receipt_id, kind) where status <> 'failed';
create index mail_preview_requests_by_source
  on mail_preview_requests (organization_id, source_id, status, expires_at);
create index mail_preview_requests_expiry
  on mail_preview_requests (organization_id, expires_at);

alter table mail_preview_requests enable row level security;
alter table mail_preview_requests force row level security;
create policy mail_preview_requests_tenant_isolation on mail_preview_requests for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);

-- API (iam_app): pide, lee, y borra al entregar. Sin UPDATE: el contenido solo lo deja el worker.
grant select, insert, delete on mail_preview_requests to iam_app;

-- Worker (iam_inbound_worker): lee lo necesario para traer el mensaje, deja el contenido cifrado y purga lo vencido.
grant select (
  id, organization_id, source_id, mailbox_uid_validity, mailbox_uid, kind, status, expires_at
) on mail_preview_requests to iam_inbound_worker;
grant update (status, result_code, completed_at, ciphertext, nonce, dek_version, expires_at)
  on mail_preview_requests to iam_inbound_worker;
grant delete on mail_preview_requests to iam_inbound_worker;

-- Descubrimiento entre organizaciones: solo pares fuente accionables, sin posiciones, personas ni contenido.
grant select (organization_id, source_id, status, expires_at) on mail_preview_requests to iam_auth_reader;
create policy mail_preview_requests_auth_lookup on mail_preview_requests for select to iam_auth_reader using (true);

create function auth.list_sources_with_pending_mail_previews(now_at timestamptz)
  returns table (organization_id uuid, source_id uuid)
  language sql stable security definer
  set search_path = pg_catalog
as $$
  select distinct r.organization_id, r.source_id
  from public.mail_preview_requests r
  join public.mail_sources s
    on s.organization_id = r.organization_id
   and s.id = r.source_id
  where r.status = 'pending'
    and r.expires_at > now_at
    and s.channel = 'mail'
    and s.status = 'active'
$$;

-- No exige fuente activa: una fuente suspendida no debe dejar contenido cifrado sin purgar.
create function auth.list_sources_with_expired_mail_previews(now_at timestamptz)
  returns table (organization_id uuid, source_id uuid)
  language sql stable security definer
  set search_path = pg_catalog
as $$
  select distinct r.organization_id, r.source_id
  from public.mail_preview_requests r
  where r.expires_at <= now_at
$$;

alter function auth.list_sources_with_pending_mail_previews(timestamptz) owner to iam_auth_reader;
alter function auth.list_sources_with_expired_mail_previews(timestamptz) owner to iam_auth_reader;
revoke all on function auth.list_sources_with_pending_mail_previews(timestamptz) from public;
revoke all on function auth.list_sources_with_expired_mail_previews(timestamptz) from public;
grant execute on function auth.list_sources_with_pending_mail_previews(timestamptz) to iam_inbound_worker;
grant execute on function auth.list_sources_with_expired_mail_previews(timestamptz) to iam_inbound_worker;
