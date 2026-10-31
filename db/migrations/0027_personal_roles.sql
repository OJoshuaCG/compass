-- Roles personales: el "permiso especial" de una sola persona se guarda como un rol oculto que solo
-- esa persona tiene. Así el motor de autorización, el techo de rango (trigger de user_roles) y el no
-- escalamiento siguen funcionando igual que con cualquier rol, sin un eje nuevo de permisos directos.
--
-- `personal_user_id` es la persona dueña del rol; NULL en las plantillas del sistema y en los roles
-- personalizados normales. Un rol personal nunca es de sistema.

alter table roles add column personal_user_id uuid;

comment on column roles.personal_user_id is
  'Persona dueña de un rol personal (permisos especiales). NULL en plantillas y roles personalizados. Un rol personal no se lista, no se edita por la pantalla de roles y no se adjunta a invitaciones.';

alter table roles
  add constraint roles_personal_owner_fk
    foreign key (organization_id, personal_user_id) references users (organization_id, id);

alter table roles
  add constraint roles_personal_not_system check (personal_user_id is null or not is_system);

-- A lo sumo un rol personal vivo por persona; al quedarse sin permisos especiales se archiva y el
-- siguiente alta crea uno nuevo.
create unique index roles_personal_one_live
  on roles (organization_id, personal_user_id)
  where personal_user_id is not null and archived_at is null;

-- El nombre de un rol personal es interno y nunca se muestra: no debe competir con los nombres de los
-- roles que sí se eligen, ni dejar que alguien con `role.manage` bloquee los permisos especiales de
-- una persona creando un rol con ese nombre ni averiguar con ello quién los tiene.
drop index roles_org_name_live;
create unique index roles_org_name_live
  on roles (organization_id, lower(name))
  where archived_at is null and personal_user_id is null;
