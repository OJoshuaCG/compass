# Cambio de rango: roles sobre el tope, protecciones y aviso

Trabajo grande sobre rutas protegidas (acceso, identidad, auditoría), encargado de forma explícita por el dueño el 2026-10-29. Los grupos quedan **diferidos** hasta que exista la compartición en la bóveda (decisión 7).

## Especificaciones (lo pedido)

Decisiones del dueño, citadas:

1. Al bajar de rango se quitan de forma persistente los roles que excedan el nuevo tope, auditado.
2. Al bajar de rango se avisa de lo que la persona compartió; no se revoca automáticamente.
3. Se protege al último administrador.
4. Motivo obligatorio al promover, opcional al bajar.
5. El correo a la persona afectada incluye el nombre de quien hizo el cambio.
6. Si la persona se queda sin ningún rol tras el recorte, se le asigna la plantilla de rol del nuevo rango (opción 1, igual que al aceptar una invitación).
7. Grupos: diferidos.

Defaults tomados (propuestos por la IA, el dueño no los objetó):

- «Último administrador» = la única persona activa de rango 1 de la organización. Los suspendidos e invitados no cuentan; la Raíz (rango 0) no cuenta porque ya está protegida. Se bloquea bajarla de rango, suspenderla y desactivarla; el conteo se hace bajo `lockHierarchy`.
- El motivo solo es obligatorio si el cambio sube la autoridad (rango numérico menor). Va a la auditoría; no va en el correo.
- El correo avisa tanto al subir como al bajar, con quién hizo el cambio, rango anterior y nuevo y fecha. Sin enlaces. Sale por la bandeja de salida (outbox, ADR 0035) para tener reintento y acuse.
- La respuesta del cambio pasa de 204 a 200 con cuerpo: roles retirados, plantilla asignada si la hubo y comparticiones vivas a revisar.
- Cambiar al mismo rango se rechaza como estado inválido.
- Comparticiones a grupos: fuera de alcance.
- Las sesiones de la persona ya se cierran al cambiar el rango (commit d592d49).

## Mapa de implementación

Contratos (`packages/contracts`): `reason` opcional en la petición; esquema de respuesta con `removedRoles`, `assignedRole` y `sharedAccounts`; códigos `USER_LAST_ADMINISTRATOR` (409) y `USER_RANK_REASON_REQUIRED` (422); textos de errores en es-MX y en-US.

Dominio: `management-policy.ts` (`isRankPromotion`, `wouldLeaveNoActiveAdministrator`); `access/domain/role-assignment.ts` (`rolesExceedingRank`). Directory no importa access: define puertos propios, como ya hace con `SessionRevoker`.

Puertos y repos: `AssignedRoleRevoker` (quitar roles sobre el tope y asignar la plantilla), `SharedByLister` (`listLiveGrantedBy` en el repositorio de comparticiones), `RankChangeNoticeQueue`, `UserDirectory.countActiveByRank`; implementaciones pg y en memoria.

Caso de uso `ManageUsers`: `changeRank(targetId, newRank, reason?)`, y la protección del último administrador en `suspend` y `deactivate`; todo en `uow.run`, una sola auditoría `user.rank_changed` con `fromRank`, `toRank`, `reason`, `removedRoles`, `assignedRole` y conteo de comparticiones. La lista blanca de metadatos de auditoría debe ampliarse (un campo no listado rompe la transacción).

Correo: tipo y método `sendRankChangeNotice` en el puerto `Mailer`, renderizador es-MX/en-US, evento de outbox y su manejador con acuse por destinatario.

Base de datos: una migración nueva con un índice parcial sobre `shares (organization_id, granted_by)`; no hay tabla nueva.

Web: el diálogo de cambio de rango pide el motivo al promover, advierte antes de bajar y muestra el resultado; textos en ambos idiomas.

Documentación: `docs/business/actors-and-hierarchy.md`, `permissions-and-sharing.md`, `roadmap-and-status.md`, `docs/backend.md`, `docs/handoff.md`.

## Tareas

- [x] Tramo 1: contratos, dominio, puertos, repositorios, caso de uso, auditoría, controlador y pruebas (unitarias e integración).
- [x] Tramo 2: correo y outbox, migración, web, i18n y documentación. (Los grupos siguen diferidos, decisión 7.)
- [x] Revisión adversarial con dos jueces ciegos sobre el alcance congelado; corregir solo lo que ambos confirmen. Ambos confirmaron dos puntos, y los dos son decisiones de negocio: quedan pendientes del dueño (ver bitácora).
- [x] Mutación deliberada de las reglas (último administrador, quitar roles, motivo) y comprobar que alguna prueba falla.
- [ ] Revisión humana de las pruebas marcadas `SENSIBLE`.

## Bitácora

- 2026-10-29: especificación escrita; el cierre de sesiones al cambiar el rango ya está hecho (d592d49).
- 2026-10-29: tramo 1 implementado (contratos, dominio, puertos, repos pg y en memoria, `ManageUsers.changeRank`, último administrador, lista blanca de auditoría, controlador 200 con cuerpo, pruebas). Pendiente de que `test-runner` las ejecute; `RankChangeNoticeQueue` usa un placeholder sin correo hasta el tramo 2.
- 2026-10-29: tramo 2 implementado. Correo por outbox (evento `user.rank_changed`, `PgRankChangeNoticeQueue` reemplaza al placeholder, `NotifyRankChanged` con acuse por destinatario, `sendRankChangeNotice` en el puerto `Mailer` y renderizador es-MX/en-US), migración 0020 (índice parcial `shares_org_granted_by_live`), diálogo web de cambio de rango (motivo, advertencia y resultado con roles retirados, plantilla y comparticiones), textos i18n y documentación. Pruebas escritas (render, manejador, SMTP, integración con base real, web) sin ejecutar: las corre `test-runner`. Los grupos siguen diferidos hasta la compartición con grupos.
- 2026-10-29: tramo 2 implementado. Correo por outbox (evento `user.rank_changed` solo con ids y números, `PgRankChangeNoticeQueue` en la misma transacción, `NotifyRankChanged` con acuse por destinataria, `sendRankChangeNotice` en SMTP, log y memoria, renderizador es-MX/en-US); se eliminó el placeholder. Migración 0020 (índice parcial `shares_org_granted_by_live`). Web: motivo obligatorio al subir, advertencia al bajar y resultado (roles retirados, plantilla, comparticiones con total); textos en ambos idiomas. Pruebas nuevas: render, manejador, SMTP, integración con base real (marcada `SENSIBLE`) y web en ambos idiomas. Documentación de negocio, backend, base de datos y traspaso actualizada. **Los grupos siguen diferidos** (decisión 7). Formato, tipos y lint verificados; ninguna prueba se ha corrido.
- 2026-10-29: pruebas dirigidas en verde (API unitarias, integración y e2e del equipo; db; web del directorio: 7 archivos, 112 pruebas). Queda rojo, y no es de este trabajo, `authorization-matrix.e2e.test.ts` (faltan en el manifiesto las rutas `POST /credentials/import` y `/credentials/import/preview`); es una prueba protegida y la revisa una persona. `pnpm e2e` no se ha corrido.
- 2026-10-29: revisión ciega con dos jueces. Coinciden en dos hallazgos, ambos decisiones de negocio y no se corrigieron por su cuenta: (1) al asignar la plantilla del nuevo rango no se compara con los permisos de quien hace el cambio (no escalamiento, ADR 0012), a diferencia de lo que pasa al invitar; la decisión 6 pedía «igual que al aceptar una invitación», que tampoco lo comprueba; (2) la respuesta lista las comparticiones de la persona (ids opacos y nivel) sin comprobar que quien cambia el rango tenga permiso sobre la bóveda. Solo un juez señaló: la repetición idempotente de 24 h no vuelve a autorizar; subir de rango activa permisos dormidos de roles personalizados; el código de emergencia puede dejar sin administrador activo (ya existía); falta una prueba con concurrencia real para `lockHierarchy`.
- 2026-10-29: mutación deliberada (quitar la protección del último administrador, el motivo al promover y el recorte de roles): fallaron 9 pruebas (6 unitarias y 3 e2e) y se restauraron los archivos originales, comprobado byte a byte.
