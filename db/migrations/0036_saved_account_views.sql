-- 0036: vistas guardadas del listado «Mis cuentas» (T5 de `odd/tasks/vault-search.md`).
--
-- Cada persona guarda búsquedas propias del listado de cuentas (texto y/o filtro rápido) para repetirlas
-- con un clic. No se comparten: una vista es una preferencia de quien la creó.
--
-- Decisiones:
--  * La política de aislamiento filtra solo por organización, como el resto de las tablas. El aislamiento
--    por persona lo impone el SQL del almacén (`where user_id = $actor`), igual que en las llaves de acceso.
--  * Una vista no concede ni revela acceso: al aplicarla, el listado vuelve a pasar por el acceso efectivo.
--  * El texto guardado es el que la persona escribió en el buscador. Puede ser un nombre de cuenta o una
--    plataforma; si escribió un usuario de la plataforma queda guardado en claro en su propia vista (riesgo
--    anotado en `odd/tasks/vault-search.md`).
--  * El nombre es único por persona sin distinguir mayúsculas. El máximo por persona lo impone el caso de
--    uso (10); la base solo acota la forma de cada fila.
--  * Sí hay DELETE: borrar una vista es una acción de la persona sobre su propia preferencia y no hay
--    auditoría que deba apuntar a la fila.
create table saved_account_views (
  id               uuid primary key default uuid_generate_v7(),
  organization_id  uuid not null references organizations (id),
  user_id          uuid not null,
  name             text not null check (char_length(name) between 1 and 60),
  search_text      text check (search_text is null or char_length(search_text) between 1 and 100),
  quick_filter     text check (quick_filter is null or quick_filter in ('review', 'no-2fa')),
  created_at       timestamptz not null default now(),
  constraint saved_account_views_has_criteria check (search_text is not null or quick_filter is not null),
  foreign key (organization_id, user_id) references users (organization_id, id)
);
comment on table saved_account_views is
  'Búsquedas guardadas de una persona sobre el listado «Mis cuentas». Preferencia personal, no se comparte.';
comment on column saved_account_views.user_id is 'Persona dueña de la vista; solo ella la lista y la borra.';
comment on column saved_account_views.name is 'Nombre que la persona le da a la vista; único por persona sin distinguir mayúsculas.';
comment on column saved_account_views.search_text is 'Texto del buscador al guardar la vista; nulo si la vista solo usa el filtro rápido.';
comment on column saved_account_views.quick_filter is 'Filtro rápido: review = por rotar (amarillo y rojo), no-2fa = falta el segundo factor.';

-- Sirve también de índice de búsqueda por organización y persona (`organization_id` primero).
create unique index saved_account_views_unique_name
  on saved_account_views (organization_id, user_id, lower(name));

alter table saved_account_views enable row level security;
alter table saved_account_views force row level security;
create policy saved_account_views_tenant_isolation on saved_account_views for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);

-- Sin UPDATE: una vista se borra y se vuelve a crear. Sin TRUNCATE.
grant select, insert, delete on saved_account_views to iam_app;
