# Decisiones del dueño del 2026-11-04: lo que se puede construir

Objetivo: llevar a cabo las tareas que se desprenden de las respuestas del dueño del 2026-11-04. Rama: `main` (autonomía del proyecto). Entrega: un commit por unidad terminada. Pruebas: Vitest (`pnpm --filter @iam/api test:unit` y `test:integration`, con Podman), siempre a través del agente `test-runner`.

## Specs

- **S1. Retención de versiones de contraseña (C9).** El dueño respondió «6.1. Opcion A», que es «30 días» para las versiones viejas de contraseña. `purge-expired` destruye las versiones de `password` reemplazadas hace 30 días o más. Nunca toca la vigente ni los demás campos (usuario, códigos de recuperación, notas), cuya retención no se decidió.
- **S2. Retención de auditoría (ADR 0024).** El dueño respondió «3. Si, no tengo problema con los 2 anios» y «1. Si, mensuales»: el ADR 0024 se ratifica con particionado mensual y la opción 1.
- **S3. Bajas (P1).** El dueño respondió:
  - «4.0. Si, quitar las 2»;
  - «4.1. Opcion B»;
  - «4.2. Opcion A, pero no podriamos asignarlo al admin mas cercano?», confirmado con «2. Si, es correcto, asignar y notificar o si no se puede , tambien alertar»;
  - «4.3. Si»;
  - «4.4. Opcion A»;
  - «4.5. Opcion A».

  Si nadie califica dentro de la rama de quien da la baja, la cuenta va al Administrador más cercano hacia arriba que tenga los permisos y se le notifica; si no hay ninguno, queda sin responsable y se alerta.
- **S4. Transferencia de la Raíz (J3).** El dueño respondió «5.1. Opcion B», «5.2. Opcion A», «5.3. Opcion A», «5.4. Es correcta la opcion A», «5.5. Ambas opciones», «5.6. Opcion A» y «5.7. Opcion A.». El detalle está en `docs/handoff.md` §5.
- **S5. Ancla de auditoría (ADR 0042).** El dueño respondió «2.1. Opcion A», «2.2. Opcion B, una vez al dia» y «2.3. Que se pueda configurar la alerta, en un panel "root" para recibir estas alertas con opciones de "Correo y/o Telegram"».
- **S6. Respaldos (C2 y L2).** El dueño respondió «7.1 Solo la opcion A»: `pg_dump` cada hora, con RPO de 1 h y RTO de 4 h.
- **S7. Documentación de lo decidido.** El dueño respondió «7.3. Opcion A» y «7.2. Si». Se refleja la fase 1a cerrada en lo funcional, el alcance de la prueba de penetración y lo demás en los documentos que lo describen.

## Tasks

| ID | Specs | Ruta | Estado | Evidencia |
| --- | --- | --- | --- | --- |
| T1 | S2, S3, S6, S7 | delegada (redactor de docs, regla del proyecto) | hecha | `e269996` y el commit de docs siguiente: governance §2.4, actors-and-hierarchy fila 8, transfer-root, respaldos (RPO 1 h), roadmap 1a cerrada, handoff |
| T2 | S1 | inline (código y pruebas) | hecha | línea base verde (21 pruebas); después 27 verdes; la rotura intencional (quitar el filtro por campo) la detectan 3 pruebas del bloque C9 |
| T3 | S3 | inline, ruta protegida | pendiente | |
| T4 | S4 | inline, ruta protegida y migración | pendiente | |
| T5 | S2 | inline, ruta protegida y migración | pendiente: depende de T6 para retirar particiones | |
| T6 | S5 (ancla) | inline, ruta protegida | bloqueada: falta aprobar el cliente S3 (dependencia nueva) y verificar Object Lock en Wasabi (comando de red) | |
| T7 | S5 (panel de alertas) | inline | bloqueada: falta decidir dónde viven los ajustes (`odd/tasks/system-settings.md`); Telegram guarda un secreto | |

## Log

- L1 (2026-11-04, textual): «1. Si, mensuales 2. Si, es correcto, asignar y notificar o si no se puede , tambien alertar Adelante con llevar a cabo todas las tareas que sean posibles, sin problema puedes llevar a cabo todas las tareas que conllevan o involucren las respuesta brindadas». Las respuestas anteriores del mismo día están en la sección Specs y en el commit `4a5be73`.
- L2 (2026-11-04): el encargo del dueño cubre las rutas protegidas que tocan estas respuestas: bajas (identidad, acceso y bóveda), transferencia de la Raíz (identidad) y auditoría. Las pruebas de autorización, aislamiento y criptografía se marcan `SENSIBLE` para revisión humana.
- L3 (2026-11-04): en T2, la aserción de `apps/api/test/purge-expired.integration.test.ts:293` («la purga no toca contraseñas») fijaba el comportamiento anterior y S1 lo cambia por decisión del dueño. Pasa a nivel del almacén de TOTP (la purga de TOTP sigue sin tocar contraseñas) y se agrega un bloque propio para la regla de contraseñas.
- L4 (2026-11-04): T2 terminada. Un solo SQL compartido (`purge-replaced-secret-versions.ts`) que recibe el campo; almacenes para `totp_uri` y `password`. Formato, tipos y lint en verde; pruebas dirigidas por `test-runner`: 27 verdes. Las pruebas del bloque C9 quedan marcadas `SENSIBLE` para revisión humana.
- L5 (2026-11-04): T1 terminada. Mapa de T3, hecho por un explorador de solo lectura:
  - la baja actual (`ManageUsers.deactivate`, `apps/api/src/modules/directory/application/manage-users.ts:158`) no toca comparticiones ni crea tareas de rotación;
  - tampoco saca a la persona de sus grupos, aunque el comentario de `db/migrations/0004_directory_access.sql:27` lo afirma;
  - no existe ayuda para subir por la cadena ni para calcular los permisos de un usuario arbitrario;
  - las tareas de rotación (`rotation_tasks`) exigen asignatario y deduplican en código.

  T3 es grande (varias sesiones): toca directorio, bóveda y acceso, notificación con plantilla en dos idiomas, informe de baja y jueces.
