-- 0038: peticiones de borrado de correo del buzón real (ADR 0045, enmienda 2026-11-10; odd/tasks/inbound-mail-delete.md).
--
-- La API NUNCA descifra la contraseña del buzón: eso es solo del worker de sondeo (modelo de amenazas, fila
-- del worker). Por eso borrar un correo es en dos tiempos: la API registra aquí una petición (ya autorizada,
-- con reautenticación y auditoría crítica) y el worker la ejecuta en su siguiente pasada con la contraseña
-- que ya maneja. El resultado queda en la misma fila.
--
-- Decisiones:
--  * La petición COPIA la posición del mensaje (UIDVALIDITY y UID) del recibo. El worker no puede leer esas
--    columnas de `inbound_receipts` (sus permisos por columna no las incluyen, y no se le amplían).
--  * Sin llave foránea al recibo: la purga del historial puede borrar el recibo y no debe bloquearse por una
--    petición vieja. La fila de petición no guarda asunto, remitente ni cuerpo: solo identificadores.
--  * Una sola petición pendiente por recibo (índice único parcial): pulsar dos veces no manda dos borrados.
--  * La API solo inserta y lee. El worker solo actualiza estado, resultado y fecha de cierre. Nadie borra:
--    la fila es el registro operativo de lo que se pidió y de lo que pasó.
--  * El worker no escribe auditoría (`audit_events` es una cadena de hashes que solo añade la aplicación):
--    la auditoría crítica de la petición la escribe la API al crearla, en la misma transacción.
--  * El worker descubre qué fuentes tienen peticiones pendientes con una función `auth.*` (precedente:
--    `auth.list_pollable_inbound_sources`, 0029), porque no puede enumerar entre organizaciones.

create table mail_delete_requests (
  id                   uuid primary key default uuid_generate_v7(),
  organization_id      uuid not null references organizations (id),
  source_id            uuid not null,
  -- Recibo cuyo mensaje se pide borrar. Sin FK a propósito (ver arriba).
  receipt_id           uuid not null,
  mailbox_uid_validity bigint not null check (mailbox_uid_validity between 0 and 4294967295),
  mailbox_uid          bigint not null check (mailbox_uid between 1 and 4294967295),
  requested_by         uuid not null,
  requested_at         timestamptz not null default now(),
  status               text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  -- Resultado acotado: DELETED, NOT_FOUND, POSITION_CHANGED, UNSUPPORTED, CONNECTION, CONNECTION_MISSING, UNEXPECTED.
  result_code          text check (result_code is null or result_code ~ '^[A-Z_]{1,64}$'),
  completed_at         timestamptz,
  constraint mail_delete_requests_closed_consistent check (
    (status = 'pending' and result_code is null and completed_at is null)
    or (status <> 'pending' and result_code is not null and completed_at is not null)
  ),
  unique (organization_id, id),
  foreign key (organization_id, source_id) references mail_sources (organization_id, id),
  foreign key (organization_id, requested_by) references users (organization_id, id)
);
comment on table mail_delete_requests is
  'Peticiones de borrar un correo del buzón IMAP real. La API las crea; el worker las ejecuta y deja el resultado.';
comment on column mail_delete_requests.receipt_id is 'Recibo del mensaje a borrar; sin llave foránea para que la purga del historial no se bloquee.';
comment on column mail_delete_requests.mailbox_uid_validity is 'UIDVALIDITY copiado del recibo al pedir el borrado; si el buzón ya tiene otro, no se borra nada.';
comment on column mail_delete_requests.mailbox_uid is 'UID copiado del recibo al pedir el borrado.';
comment on column mail_delete_requests.requested_by is 'Persona que pidió el borrado, ya autorizada y con reautenticación reciente.';
comment on column mail_delete_requests.status is 'pending = esperando al worker; done = el servidor confirmó el borrado; failed = no se borró (ver result_code).';
comment on column mail_delete_requests.result_code is 'Resultado acotado del worker; nunca texto del servidor.';

-- Una sola petición pendiente por recibo; también sirve de índice para la lectura por organización.
create unique index mail_delete_requests_one_pending_per_receipt
  on mail_delete_requests (organization_id, receipt_id) where status = 'pending';
create index mail_delete_requests_by_source
  on mail_delete_requests (organization_id, source_id, requested_at desc);

alter table mail_delete_requests enable row level security;
alter table mail_delete_requests force row level security;
create policy mail_delete_requests_tenant_isolation on mail_delete_requests for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);

-- API (iam_app): crea y lee. Sin UPDATE ni DELETE: el cierre es del worker.
grant select, insert on mail_delete_requests to iam_app;

-- Worker (iam_inbound_worker): lee lo que necesita para ejecutar y solo actualiza estado y resultado.
grant select (
  id, organization_id, source_id, mailbox_uid_validity, mailbox_uid, status
) on mail_delete_requests to iam_inbound_worker;
grant update (status, result_code, completed_at) on mail_delete_requests to iam_inbound_worker;

-- Descubrimiento entre organizaciones: solo pares fuente accionables, sin posiciones ni personas.
grant select (organization_id, source_id, status) on mail_delete_requests to iam_auth_reader;
create policy mail_delete_requests_auth_lookup on mail_delete_requests for select to iam_auth_reader using (true);

create function auth.list_sources_with_pending_mail_deletes()
  returns table (organization_id uuid, source_id uuid)
  language sql stable security definer
  set search_path = pg_catalog
as $$
  select distinct r.organization_id, r.source_id
  from public.mail_delete_requests r
  join public.mail_sources s
    on s.organization_id = r.organization_id
   and s.id = r.source_id
  where r.status = 'pending'
    and s.channel = 'mail'
    and s.status = 'active'
$$;

alter function auth.list_sources_with_pending_mail_deletes() owner to iam_auth_reader;
revoke all on function auth.list_sources_with_pending_mail_deletes() from public;
grant execute on function auth.list_sources_with_pending_mail_deletes() to iam_inbound_worker;
