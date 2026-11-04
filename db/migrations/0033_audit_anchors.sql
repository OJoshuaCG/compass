-- Ancla externa de la cadena de auditoría (ADR 0042, opción B; decisión del dueño del 2026-11-04).
--
-- Una vez al día, un trabajo (`main.anchor-audit.ts`) registra aquí, por organización, la cabeza de su cadena
-- (`seq` y `hash` del último evento) y publica el mismo manifiesto en un bucket de Wasabi con Object Lock en
-- modo de cumplimiento. Esta tabla es el registro LOCAL de lo anclado: sirve para encadenar los manifiestos
-- (la credencial de publicación solo puede escribir, no leer el manifiesto anterior) y para el control de
-- retiro de particiones del ADR 0024. NO es la evidencia: quien borre la base puede borrar esta tabla; la
-- evidencia es la copia inmutable en el bucket.
--
-- Igual que `audit_events`, la base y no la aplicación asigna el número de manifiesto, la cabeza anclada, el
-- hash del manifiesto anterior, el hash propio y la fecha (trigger BEFORE INSERT); lo que mande el cliente se
-- sobrescribe. Así un llamador con errores no puede anclar una cabeza inventada ni romper el encadenamiento.
--
-- Por organización y no un manifiesto global: toda tabla lleva organización y aislamiento por filas, y el rol
-- de la aplicación solo ve la organización fijada en `app.org_id`.
create table audit_anchors (
  id                 uuid primary key default uuid_generate_v7(),
  organization_id    uuid not null references organizations (id),
  -- Consecutivo por organización, empieza en 1.
  manifest_number    bigint not null,
  -- `seq` del último evento de auditoría visible al anclar; 0 si la organización aún no tiene eventos.
  anchored_seq       bigint not null check (anchored_seq >= 0),
  -- `hash` de ese evento; 32 bytes en cero si no hay eventos (mismo génesis que la cadena).
  anchored_hash      bytea not null check (length(anchored_hash) = 32),
  -- `manifest_hash` del manifiesto anterior de la organización; 32 bytes en cero en el primero.
  prev_manifest_hash bytea not null check (length(prev_manifest_hash) = 32),
  manifest_hash      bytea not null check (length(manifest_hash) = 32),
  anchored_at        timestamptz not null default now(),
  -- También es el índice por organización: toda consulta empieza por ella.
  unique (organization_id, manifest_number)
);
comment on table audit_anchors is
  'Registro local de los manifiestos publicados en el bucket inmutable (ADR 0042). No es evidencia: la evidencia es la copia en el bucket.';
comment on column audit_anchors.anchored_seq is
  'seq del último evento de auditoría de la organización al anclar; 0 si no había eventos.';
comment on column audit_anchors.manifest_hash is
  'sha256 de audit_anchor_hash(...): encadena este manifiesto con el anterior de la misma organización.';

-- Hash = sha256(utf8(jsonb_build_array(...)::text)), la misma codificación sin ambigüedad que usa
-- `audit_event_hash` (migración 0006). La fecha va en microsegundos desde la época para no depender de la
-- zona horaria de la sesión. El verificador diario (TODO H1) recalcula este valor desde el manifiesto del bucket.
create function audit_anchor_hash(
  p_prev_manifest_hash bytea, p_organization_id uuid, p_manifest_number bigint,
  p_anchored_seq bigint, p_anchored_hash bytea, p_anchored_at timestamptz
) returns bytea
  language sql immutable
  set search_path = pg_catalog
as $$
  select sha256(convert_to(
    jsonb_build_array(
      encode(p_prev_manifest_hash, 'hex'), p_organization_id, p_manifest_number,
      p_anchored_seq, encode(p_anchored_hash, 'hex'),
      floor(extract(epoch from p_anchored_at) * 1000000)::bigint
    )::text,
    'UTF8'
  ))
$$;

create function audit_anchors_chain() returns trigger
  language plpgsql
  set search_path = pg_catalog, public
as $$
declare
  v_prev_hash   bytea;
  v_prev_number bigint;
  v_head_seq    bigint;
  v_head_hash   bytea;
begin
  -- Dos anclas simultáneas de la misma organización no pueden leer el mismo «anterior». El bloqueo dura hasta
  -- COMMIT; es distinto del de `audit_events`, así que anclar no detiene las escrituras de auditoría.
  perform pg_advisory_xact_lock(hashtextextended('audit_anchors:' || new.organization_id::text, 0));

  select a.manifest_hash, a.manifest_number into v_prev_hash, v_prev_number
  from public.audit_anchors a
  where a.organization_id = new.organization_id
  order by a.manifest_number desc
  limit 1;

  select e.seq, e.hash into v_head_seq, v_head_hash
  from public.audit_events e
  where e.organization_id = new.organization_id
  order by e.seq desc
  limit 1;

  new.manifest_number    := coalesce(v_prev_number, 0) + 1;
  new.prev_manifest_hash := coalesce(v_prev_hash, decode(repeat('00', 32), 'hex'));
  new.anchored_seq       := coalesce(v_head_seq, 0);
  new.anchored_hash      := coalesce(v_head_hash, decode(repeat('00', 32), 'hex'));
  new.anchored_at        := clock_timestamp();
  new.manifest_hash      := public.audit_anchor_hash(
    new.prev_manifest_hash, new.organization_id, new.manifest_number,
    new.anchored_seq, new.anchored_hash, new.anchored_at
  );
  return new;
end
$$;
create trigger audit_anchors_chain before insert on audit_anchors
  for each row execute function audit_anchors_chain();

-- Defensa en profundidad: ni el dueño de la tabla reescribe el registro de anclas.
create function audit_anchors_reject_change() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
begin
  raise exception 'audit_anchors is append-only (% rejected)', tg_op using errcode = '42501';
end
$$;
create trigger audit_anchors_no_update_delete before update or delete on audit_anchors
  for each row execute function audit_anchors_reject_change();
create trigger audit_anchors_no_truncate before truncate on audit_anchors
  for each statement execute function audit_anchors_reject_change();

alter table audit_anchors enable row level security;
alter table audit_anchors force row level security;
-- Solo lectura e inserción: sin política de UPDATE ni DELETE, esos comandos no alcanzan ninguna fila.
create policy audit_anchors_read on audit_anchors for select
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
create policy audit_anchors_insert on audit_anchors for insert
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
grant select, insert on audit_anchors to iam_app;
revoke update, delete, truncate on audit_anchors from iam_app;
revoke update, delete, truncate on audit_anchors from public;
revoke update, delete, truncate on audit_anchors from current_user;
