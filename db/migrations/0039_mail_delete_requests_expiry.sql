-- 0039: caducidad de las peticiones de borrado de correo (odd/tasks/inbound-mail-delete.md, L9).
--
-- Una petición pendiente no puede esperar sin límite: si la fuente se suspende y se reactiva semanas después,
-- el worker ejecutaría un borrado que una persona pidió (y reautenticó) mucho antes. El dueño decidió que una
-- petición caduca a las 24 horas y que la persona vuelve a pedirla si hace falta.
--
-- Esta migración NO edita la 0038 (migración aplicada). Hace dos cosas:
--  1. Deja que el worker y el descubrimiento lean `requested_at`, y solo esa columna nueva. El worker lo usa
--     para no ejecutar nunca una petición vencida y para cerrarla como fallida con el resultado `EXPIRED`.
--  2. Agrega una función de descubrimiento de fuentes con peticiones vencidas que, a diferencia de la de la
--     0038, NO exige que la fuente esté activa: una fuente suspendida no debe dejar la petición pendiente para
--     siempre (el índice único parcial impediría volver a pedir ese recibo).
--
-- El límite en horas vive en el código del worker y llega como parámetro: la base no lo decide.
-- Lo que NO hace: no da UPDATE nuevo (el worker ya solo actualiza estado, resultado y fecha de cierre), no
-- toca la API y no cambia el aislamiento por organización.

grant select (requested_at) on mail_delete_requests to iam_inbound_worker;
grant select (requested_at) on mail_delete_requests to iam_auth_reader;

comment on column mail_delete_requests.result_code is
  'Resultado acotado del worker; nunca texto del servidor. EXPIRED = pasó el límite de espera sin ejecutarse.';

create function auth.list_sources_with_stale_mail_deletes(cutoff timestamptz)
  returns table (organization_id uuid, source_id uuid)
  language sql stable security definer
  set search_path = pg_catalog
as $$
  select distinct r.organization_id, r.source_id
  from public.mail_delete_requests r
  where r.status = 'pending'
    and r.requested_at < cutoff
$$;

alter function auth.list_sources_with_stale_mail_deletes(timestamptz) owner to iam_auth_reader;
revoke all on function auth.list_sources_with_stale_mail_deletes(timestamptz) from public;
grant execute on function auth.list_sources_with_stale_mail_deletes(timestamptz) to iam_inbound_worker;
