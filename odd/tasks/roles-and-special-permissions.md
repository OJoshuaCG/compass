# Pantalla de roles y permisos, y permisos especiales por persona

Estado: **en curso** (2026-10-31), sin commitear. Ruta protegida (acceso, autorización, migración con aislamiento por filas, auditoría): el dueño asignó el trabajo; requiere jueces ciegos y prueba de mutación (ambas hechas en el backend).

## Especificación

Pedido textual del dueño: "Me gustaría que agregaras un apartado de permisos, uno de roles y permisos, sería lo mejor. Como ver los roles, ver los permisos, y personalizarlos. Aun así, poder con cada usuario, asignarle los permisos necesarios en caso que uno ocupe un permiso especial. Debe ser posible y tenerlo ya listo vía web". Tras proponer dos fases: "Creo que ambos" y "Adelante con el orden necesario".

Reglas:

1. La pantalla «Roles y permisos» tiene dos pestañas: roles (lo que ya existía) y catálogo de permisos con el rango más bajo que puede tenerlos.
2. Desde el equipo se asignan roles a una persona ya existente y se le dan permisos especiales.
3. Un permiso especial es un **rol personal oculto**, uno por persona. Así el motor de autorización, el techo de rango, el no escalamiento y la auditoría funcionan igual que con cualquier rol.
4. Ver los roles de una persona exige `user.invite` sobre ella. Cambiarlos exige `role.assign` (con reautenticación y jerarquía). Nadie se los asigna a sí mismo y la Raíz no se modifica.
5. No escalamiento: quien asigna debe tener todos los permisos de cada rol que agrega y de cada permiso especial. Quitar no exige tenerlos.
6. El rol personal no se lista, no se edita ni se archiva desde la pantalla de roles y no se elige al invitar. Su nombre es interno y no compite con los nombres de los roles reales.
7. Si un cambio de rango deja al rol personal por encima del techo, se suelta en silencio y no cuenta para decidir si hace falta la plantilla.
8. Cada cambio audita en la misma transacción (`user.roles_changed`, `user.special_permissions_changed`), con los conteos y qué cambió (ids de rol y nombres de permiso, decisión del dueño del 2026-10-31); las negaciones también.

Fase 2 (solo si hace falta, no ahora): permisos directos por persona, sin rol intermedio.

## Decisiones de diseño

- **Rol personal en vez de un eje nuevo de permisos directos**: no toca el cálculo de permisos efectivos ni el trigger de techo de la migración 0015.
- **Índice de nombres de rol parcial**: los jueces confirmaron que un rol llamado como el personal podía bloquear permisos especiales y revelar quién los tiene; la migración 0027 excluye los roles personales del índice único de nombres.
- **Auditoría con conteos y detalle**: el dueño decidió (2026-10-31) que guarde ambos. Los ids de rol y los nombres de permiso se unen con coma y se truncan a elementos completos (límite de 256 de la auditoría); nunca nombres de roles.

## Tareas

- [x] Migración 0027 (sin aplicar), repositorio, casos de uso, controlador, contratos, auditoría y contenedor.
- [x] Web: pestañas, catálogo, diálogo de acceso de la persona; i18n es-MX y en-US.
- [x] Pruebas e2e de API (17 o más) y de web.
- [x] Jueces ciegos A y B sobre el backend; prueba de mutación (quitar la comprobación del techo hizo fallar dos pruebas).
- [x] Simplify (predicado compartido, `Set`, constante sin ajuste, paginación compartida).
- [ ] Revisión de seguridad y re-ejecución de pruebas tras simplify.
- [ ] Jueces ciegos sobre la parte web (opcional).

## Pendientes del dueño

- Resueltos el 2026-10-31: auditar qué cambió (hecho), clasificar `/credentials/import*` en la matriz (hecho), Líder conserva `user.invite_link` por defecto, migraciones sin aplicar hasta otra fase.

## Bitácora

- 2026-10-31: especificación y diseño. La migración toma el número 0027; IC-3a pasa a ser la 0028.
