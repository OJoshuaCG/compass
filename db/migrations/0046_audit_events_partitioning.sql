-- 0046: audit_events pasa a ser una tabla particionada por mes sobre created_at (ADR 0024).
--
-- La tabla creada en 0006 NO se copia ni se reescribe: se renombra a audit_events_legacy y se
-- adjunta como primera partición (todo hasta el fin del mes en curso). Los eventos existentes
-- conservan id, seq, prev_hash y hash, así que la cadena y las anclas externas (ADR 0042) siguen
-- siendo válidas. No se borra, trunca ni elimina ningún dato.
--
-- seq ya no es único en toda la base de datos (ADR 0024, aceptado por Jor-El el 2026-11-20 con tres
-- condiciones). Lo que lo mantiene único por organización ahora:
--   1. un índice único (organization_id, seq) EN CADA partición (no puede abarcar todas, porque una
--      restricción única de una tabla particionada debe incluir created_at);
--   2. el candado consultivo por organización de audit_events_chain() (sin cambios, 0006), lo único
--      que serializa a los escritores entre particiones;
--   3. audit_verify_chain() (sin cambios, 0006), que reporta un seq duplicado o saltado aunque esté
--      en dos particiones distintas, más las pruebas de db/tests/audit-partitioning.test.ts.
-- id corre la misma suerte: la llave primaria (id) no puede abarcar particiones, así que cada
-- partición lleva un índice único (id) y la unicidad entre particiones descansa en UUIDv7.
--
-- Un mes sin partición hace fallar todo insert de auditoría (la auditoría falla cerrada), por eso
-- esta migración crea 24 meses por adelantado y audit_create_month_partition() crea más después
-- (runbook de particiones). El retiro de particiones antiguas (DETACH/DROP, checkpoints, rol de
-- archivado) NO forma parte de esta migración: depende del ancla externa del ADR 0042.
--
-- Probar primero en una base local o de staging: ATTACH toma un bloqueo ACCESS EXCLUSIVE sobre
-- audit_events_legacy mientras se construyen los índices nuevos.

-- 1. Liberar los nombres que necesita la tabla particionada (los nombres de relación e índice son
--    únicos por esquema). Los disparadores y las políticas son por tabla y conservan su nombre.
alter table audit_events rename to audit_events_legacy;
-- Una tabla solo puede tener una llave primaria: la (id) antigua se sustituye por la (id, created_at)
-- del padre cuando ATTACH la construye. Ninguna fila cambia y nada referencia estos ids; la
-- unicidad de id se conserva con el índice único de abajo.
alter table audit_events_legacy drop constraint audit_events_pkey;
create unique index audit_events_legacy_id_key on audit_events_legacy (id);
alter table audit_events_legacy
  rename constraint audit_events_organization_id_seq_key to audit_events_legacy_organization_id_seq_key;
alter index audit_events_org_target rename to audit_events_legacy_org_target;
alter index audit_events_org_actor rename to audit_events_legacy_org_actor;
alter index audit_events_org_action rename to audit_events_legacy_org_action;
alter index audit_events_org_request rename to audit_events_legacy_org_request;
alter index audit_events_org_actor_action_time rename to audit_events_legacy_org_actor_action_time;

-- Los disparadores de fila del padre se clonan en cada partición, incluida la adjunta: hay que quitar
-- los de la tabla legada o cada evento se encadenaría dos veces.
drop trigger audit_events_chain on audit_events_legacy;
drop trigger audit_events_no_update_delete on audit_events_legacy;
drop trigger audit_events_no_truncate on audit_events_legacy;

-- 2. La tabla particionada. Mismas columnas y restricciones que en 0006; la llave primaria y la
--    única deben contener la columna de partición. Las restricciones CHECK llevan nombre explícito,
--    el mismo que ya tiene la tabla legada: ATTACH PARTITION compara las CHECK por nombre.
create table audit_events (
  id              uuid not null default uuid_generate_v7(),
  organization_id uuid not null references organizations (id),
  seq             bigint not null,
  actor_id        uuid,  -- NULL en eventos de sistema y previos a la autenticación
  action          text not null
    constraint audit_events_action_check check (length(action) between 1 and 100),
  target_type     text,
  target_id       uuid,
  outcome         text not null
    constraint audit_events_outcome_check check (outcome in ('success', 'denied', 'failure')),
  reason_code     text,
  ip              inet,
  request_id      text,
  metadata        jsonb not null default '{}'::jsonb
    constraint audit_events_metadata_check check (jsonb_typeof(metadata) = 'object'),
  prev_hash       bytea not null default '\x'::bytea,
  hash            bytea not null default '\x'::bytea,
  -- clock_timestamp() y no now(): la fila se enruta con este valor por omisión y DESPUÉS
  -- audit_events_chain() lo sobrescribe con otro clock_timestamp(), tras esperar el candado consultivo
  -- de la organización. Si esa espera cruza la medianoche UTC del día 1, la fila enrutada al mes M
  -- recibe un created_at del mes M+1 y el insert falla cerrado (23514), junto con la acción auditada.
  -- La ventana es el tiempo de espera del candado, no microsegundos: la aplicación debe reintentar.
  created_at      timestamptz not null default clock_timestamp(),
  primary key (id, created_at),
  unique (organization_id, seq, created_at),
  foreign key (organization_id, actor_id) references users (organization_id, id)
) partition by range (created_at);

comment on table audit_events is
  'Bitácora de auditoría de solo anexar, encadenada por hash por organización y particionada por mes sobre created_at (ADR 0024). seq e id son únicos solo por partición (índices únicos), con el candado consultivo de audit_events_chain() y audit_verify_chain() como garantía entre particiones.';

create index audit_events_org_target on audit_events (organization_id, target_type, target_id, seq desc);
create index audit_events_org_actor on audit_events (organization_id, actor_id, seq desc);
create index audit_events_org_action on audit_events (organization_id, action, seq desc);
create index audit_events_org_request on audit_events (organization_id, request_id) where request_id is not null;
create index audit_events_org_actor_action_time
  on audit_events (organization_id, actor_id, action, created_at desc);

-- Las mismas funciones de 0006 (no se redefinen): resuelven audit_events por nombre al ejecutarse.
create trigger audit_events_chain before insert on audit_events
  for each row execute function audit_events_chain();
create trigger audit_events_no_update_delete before update or delete on audit_events
  for each row execute function audit_events_reject_change();
create trigger audit_events_no_truncate before truncate on audit_events
  for each statement execute function audit_events_reject_change();

alter table audit_events enable row level security;
alter table audit_events force row level security;
create policy audit_events_read on audit_events for select
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
create policy audit_events_insert on audit_events for insert
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
grant select, insert on audit_events to iam_app;
revoke update, delete, truncate on audit_events from iam_app;
revoke update, delete, truncate on audit_events from public;
revoke update, delete, truncate on audit_events from current_user;

-- 3. Particiones mensuales. Devuelve el nombre de la partición, haya sido creada ahora o ya existiera.
--    Si el mes ya lo cubre otra partición (p. ej. el mes en curso, cubierto por la legada), o si el
--    nombre está ocupado por algo que no es la partición de ese mes, falla con un error claro
--    (22023) en lugar de un conflicto de rangos. Pertenece al rol de migraciones: iam_app no
--    puede ejecutarla.
create function audit_create_month_partition(p_month date) returns text
  language plpgsql
  set search_path = pg_catalog, public
as $$
declare
  v_name text;
  v_from timestamptz;
  v_to   timestamptz;
  v_existing_bound text;
begin
  if p_month is null or p_month <> date_trunc('month', p_month)::date then
    raise exception 'p_month debe ser el primer día de un mes' using errcode = '22023';
  end if;

  v_name := 'audit_events_p' || to_char(p_month, 'YYYYMM');

  -- Los meses son meses UTC, independientes del TimeZone de la sesión.
  v_from := p_month::timestamp at time zone 'UTC';
  v_to := (p_month + interval '1 month')::timestamp at time zone 'UTC';

  -- Un nombre ocupado solo cuenta como «mes ya cubierto» si es una partición adjunta de audit_events
  -- con exactamente el rango de ese mes. Una tabla común, una partición separada o una con otro
  -- rango no cubren el mes: devolver su nombre haría creer que la auditoría puede escribir ahí
  -- cuando el insert fallaría cerrado. El texto del rango se compara tal como lo imprime PostgreSQL
  -- para la zona horaria de la sesión (el mismo formato en ambos lados).
  if to_regclass(format('public.%I', v_name)) is not null then
    select pg_get_expr(c.relpartbound, c.oid)
      into v_existing_bound
      from pg_class c
      join pg_inherits i on i.inhrelid = c.oid
     where c.oid = to_regclass(format('public.%I', v_name))
       and i.inhparent = 'public.audit_events'::regclass;

    if v_existing_bound is distinct from format('FOR VALUES FROM (%L) TO (%L)', v_from, v_to) then
      raise exception 'la relación % existe pero no es la partición adjunta de audit_events para el mes %',
        v_name, p_month using errcode = '22023';
    end if;
    return v_name;
  end if;

  -- Clona del padre: índices, llave primaria y los disparadores de encadenado y de solo anexar.
  begin
    execute format(
      'create table public.%I partition of public.audit_events for values from (%L) to (%L)',
      v_name, v_from, v_to);
  exception
    when sqlstate '42P17' then
      raise exception 'el mes % ya está cubierto por otra partición', p_month using errcode = '22023';
  end;

  -- Únicos por partición: seq e id no pueden ser únicos entre particiones en la base (ver cabecera).
  execute format(
    'create unique index %I on public.%I (organization_id, seq)',
    v_name || '_org_seq_key', v_name);
  execute format('create unique index %I on public.%I (id)', v_name || '_id_key', v_name);

  -- Una consulta directa a la partición usa las políticas de esa partición, no las del padre.
  execute format('alter table public.%I enable row level security', v_name);
  execute format('alter table public.%I force row level security', v_name);
  execute format(
    'create policy audit_events_read on public.%I for select
       using (organization_id = nullif(current_setting(''app.org_id'', true), '''')::uuid)',
    v_name);
  execute format(
    'create policy audit_events_insert on public.%I for insert
       with check (organization_id = nullif(current_setting(''app.org_id'', true), '''')::uuid)',
    v_name);

  -- Un disparador de sentencia no se clona a las particiones: la guarda de TRUNCATE va a mano.
  execute format(
    'create trigger audit_events_no_truncate before truncate on public.%I
       for each statement execute function public.audit_events_reject_change()', v_name);

  -- La aplicación llega a los eventos solo por el padre (los privilegios se revisan allí); un permiso
  -- directo sobre una partición sería una segunda puerta, aunque unos privilegios por omisión del
  -- esquema lo concedieran.
  execute format('revoke all on public.%I from public', v_name);
  execute format('revoke all on public.%I from iam_app', v_name);
  execute format('revoke update, delete, truncate on public.%I from current_user', v_name);

  return v_name;
end
$$;
revoke all on function audit_create_month_partition(date) from public;

-- 4. Adjuntar la tabla antigua como primera partición. Un CHECK que ya implica el rango de la
--    partición, validado de antemano, deja que ATTACH se salte el escaneo completo bajo el bloqueo
--    exclusivo. La cota superior es el inicio del mes UTC siguiente, así que también cubre todo lo
--    escrito este mes. Después se crean 24 meses por adelantado desde el primer mes no cubierto.
do $$
declare
  v_upper         timestamptz;
  v_upper_literal text;
  v_first_month   date;
  v_offset        integer;
begin
  select ((date_trunc('month', greatest(now(), coalesce(max(e.created_at), now())) at time zone 'UTC')
           + interval '1 month') at time zone 'UTC')
  into v_upper
  from public.audit_events_legacy e;

  v_upper_literal := to_char(v_upper at time zone 'UTC', 'YYYY-MM-DD') || ' 00:00:00+00';

  execute format(
    'alter table public.audit_events_legacy add constraint audit_events_legacy_range
       check (created_at < %L::timestamptz) not valid', v_upper_literal);
  alter table public.audit_events_legacy validate constraint audit_events_legacy_range;
  execute format(
    'alter table public.audit_events attach partition public.audit_events_legacy
       for values from (minvalue) to (%L)', v_upper_literal);
  alter table public.audit_events_legacy drop constraint audit_events_legacy_range;

  v_first_month := (v_upper at time zone 'UTC')::date;
  for v_offset in 0..23 loop
    perform public.audit_create_month_partition((v_first_month + make_interval(months => v_offset))::date);
  end loop;
end
$$;

comment on table audit_events_legacy is
  'Primera partición de audit_events: todo evento escrito antes del particionado del ADR 0024 (migración 0046), hasta el fin de ese mes. Nunca se copió; se conserva tal cual para que hashes y anclas externas sigan válidos.';

-- Un disparador de sentencia no se clona a las particiones: la guarda de TRUNCATE va a mano.
create trigger audit_events_no_truncate before truncate on audit_events_legacy
  for each statement execute function audit_events_reject_change();

-- La aplicación llega a las particiones solo por audit_events (los privilegios se revisan en el padre);
-- un permiso directo sobre una partición sería una segunda puerta.
revoke select, insert on audit_events_legacy from iam_app;
