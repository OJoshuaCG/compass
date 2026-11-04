-- 0035: transferencia de la Raíz (decisión del dueño del 2026-11-04, J3; respuestas «Si a todo» a las cinco
-- preguntas de la fase 1c, ver odd/tasks/owner-decisions-2026-11-04.md, L22).
--
-- Una transferencia cambia quién es la Raíz de la organización: la Raíz actual propone a un Administrador
-- activo, esa persona acepta, hay 72 horas de espera (contadas desde la aceptación) y un proceso periódico la
-- completa. Esta tabla guarda el estado de ese proceso; el intercambio de rangos lo hace el caso de uso en una
-- sola transacción, no esta tabla.
--
-- Decisiones:
--  * Una sola transferencia abierta por organización (índice único parcial): proponer otra mientras hay una
--    abierta se rechaza. Abierta = `pending_acceptance` o `waiting`.
--  * La propuesta caduca a los 7 días si nadie la acepta (`expires_at`); tras aceptarla ya no caduca, solo se
--    completa o se cancela. Las 72 horas corren desde `accepted_at` (`executes_at`).
--  * Sin DELETE: cada transferencia queda como historia y la auditoría apunta siempre a una fila que existe.
--  * La fila no guarda secretos ni nombres: solo ids de personas y fechas.
create table root_transfers (
  id               uuid primary key default uuid_generate_v7(),
  organization_id  uuid not null references organizations (id),
  -- Raíz que propone y Administrador que recibiría el puesto.
  from_user_id     uuid not null,
  to_user_id       uuid not null,
  status           text not null default 'pending_acceptance'
                   check (status in ('pending_acceptance', 'waiting', 'completed', 'cancelled', 'expired')),
  requested_at     timestamptz not null,
  -- Fecha límite para aceptar (propuesta + 7 días). Nula no existe: toda propuesta caduca.
  expires_at       timestamptz not null,
  -- Se llenan al aceptar: la espera de 72 horas corre desde `accepted_at` y termina en `executes_at`.
  accepted_at      timestamptz,
  executes_at      timestamptz,
  -- Se llenan al cerrar la transferencia (completada, cancelada o caducada).
  closed_at        timestamptz,
  -- Quién canceló (la Raíz, la destinataria o cualquier Administrador) y por qué: `manual` o el motivo
  -- automático (`target_not_active_admin`, `expired`). Nulos mientras esté abierta o si se completó; el
  -- motivo existe también cuando caducó.
  cancelled_by     uuid,
  cancel_reason    text check (cancel_reason in ('manual', 'target_not_active_admin', 'expired')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, from_user_id) references users (organization_id, id),
  foreign key (organization_id, to_user_id) references users (organization_id, id),
  foreign key (organization_id, cancelled_by) references users (organization_id, id),
  constraint root_transfers_distinct_people check (from_user_id <> to_user_id),
  -- La espera solo existe una vez aceptada, y las dos fechas van juntas.
  constraint root_transfers_waiting_has_dates check (
    (status = 'pending_acceptance' and accepted_at is null and executes_at is null)
    or (status = 'waiting' and accepted_at is not null and executes_at is not null)
    or status in ('completed', 'cancelled', 'expired')
  ),
  constraint root_transfers_closed_has_date check (
    (status in ('pending_acceptance', 'waiting')) = (closed_at is null)
  ),
  -- Hay motivo de cancelación si y solo si la transferencia se canceló o caducó.
  constraint root_transfers_cancel_fields check (
    (status in ('cancelled', 'expired')) = (cancel_reason is not null)
  )
);
comment on table root_transfers is
  'Transferencias de la Raíz: propuesta, aceptación, espera de 72 horas y cierre. Una abierta por organización.';
comment on column root_transfers.from_user_id is 'Raíz que propone la transferencia.';
comment on column root_transfers.to_user_id is 'Administrador activo que recibiría el puesto de Raíz.';
comment on column root_transfers.status is
  'pending_acceptance (espera aceptación), waiting (aceptada, 72 h de espera), completed, cancelled o expired.';
comment on column root_transfers.expires_at is 'Fecha límite para aceptar: la propuesta caduca a los 7 días.';
comment on column root_transfers.accepted_at is 'Momento de la aceptación; las 72 horas de espera corren desde aquí.';
comment on column root_transfers.executes_at is 'accepted_at + 72 horas: desde aquí el proceso periódico puede completarla.';
comment on column root_transfers.closed_at is 'Momento en que la transferencia dejó de estar abierta (completada, cancelada o caducada).';
comment on column root_transfers.cancelled_by is 'Persona que canceló; nulo si la cancelación fue automática.';
comment on column root_transfers.cancel_reason is 'manual, target_not_active_admin (la destinataria dejó de ser Administradora activa) o expired.';

-- Una sola transferencia abierta por organización.
create unique index root_transfers_one_open on root_transfers (organization_id)
  where status in ('pending_acceptance', 'waiting');
-- El proceso periódico busca las que ya pueden completarse o caducar, organización por organización.
create index root_transfers_org_status_executes on root_transfers (organization_id, status, executes_at);
create trigger root_transfers_touch before update on root_transfers
  for each row execute function touch_updated_at();

alter table root_transfers enable row level security;
alter table root_transfers force row level security;
create policy root_transfers_tenant_isolation on root_transfers for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);

-- Sin DELETE ni TRUNCATE. El UPDATE se limita a las columnas que cambian durante el proceso.
grant select, insert,
  update (status, accepted_at, executes_at, closed_at, cancelled_by, cancel_reason, updated_at)
  on root_transfers to iam_app;
