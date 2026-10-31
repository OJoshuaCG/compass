# Ajustes del sistema en base de datos (retención del outbox como primer caso)

**Estado: DIFERIDO.** No se crea tabla, permiso ni puerto mientras no haya un consumidor de escritura ni pantalla: sería código muerto en una ruta protegida (migraciones con aislamiento, permisos, auditoría). Retomar con el disparador de abajo.

## Especificaciones (lo pedido)

El dueño: «una tabla system settings en la DB, no en .env». Primer ajuste: la retención del outbox (hoy la constante `OUTBOX_RETENTION_DAYS = 7`, ver `odd/tasks/outbox-hardening.md`).

Dos jueces ciegos (`jd-judge-a` y `jd-judge-b`) coinciden: **aprobar con cambios, pero diferir**.

## Disparador para retomarlo

Cualquiera de estos, en un único cambio:

- Aparece un **segundo ajuste** que quiera ser configurable.
- Se construye la **pantalla** (o el caso de uso de escritura) que edita ajustes.

Mientras tanto la constante es el defecto y el contrato; una prueba fija su valor en 7.

## Decisión pendiente antes de construir

El valor es **por organización** (la purga ya recorre organizaciones con `runAs` bajo aislamiento por filas). Hay que elegir:

| Opción | A favor | En contra |
| --- | --- | --- |
| Reutilizar `organizations.settings` (jsonb, con UPDATE concedido a `iam_app`) y el permiso `org.settings` (techo 0, solo Raíz, reautenticación, auditoría crítica) | Sin tabla ni migración de permisos | Escrituras concurrentes sobre un jsonb compartido (carrera), auditoría anterior/nuevo menos exacta, sin versión por clave |
| Tabla propia con una fila tipada por clave | Auditoría por clave, sin carrera de jsonb, columna de versión | Migración con aislamiento (ruta protegida), más superficie |

Si el dueño exige que **Administrador** pueda editar, hace falta un permiso nuevo con migración tipo 0021: techo, roles de sistema, versión de roles, contratos, i18n y prueba de sincronía. Ojo: Administrador heredaría ese permiso.

## Reglas de diseño acordadas

- Catálogo **cerrado** de claves en código, cada una con su rango (`outbox.retention_days`: 1–365, defecto 7).
- Validar al escribir **y al leer**: un valor inválido usa el defecto 7 y registra una advertencia **sin el valor**; nunca se borra de más.
- Leer dentro del mismo `runAs` de cada organización.
- Escribir con bloqueo de fila, o upsert con valor previo, y columna de versión, para que la auditoría anterior/nuevo sea exacta.
- Permisos mínimos: sin `delete`. Llave primaria (organización, clave).
- `settings.updated` en la lista blanca de auditoría; las negaciones también se auditan.
- La constante `OUTBOX_RETENTION_DAYS` se queda como defecto y contrato.
- Ruta protegida: requiere encargo humano y ADR (no aceptado todavía; se propondría como borrador al retomarlo).

## Tareas (no iniciadas)

- [ ] Esperar el disparador.
- [ ] Decidir: reutilizar `organizations.settings` y `org.settings`, o tabla propia.
- [ ] Decidir si Administrador edita (permiso nuevo tipo 0021) o solo la Raíz.
- [ ] Encargo humano explícito y ADR en borrador marcado «propuesto».
- [ ] Implementación según las reglas de arriba, con pruebas de aislamiento y permisos revisadas por una persona.

## Bitácora

- 2026-10-30: revisión ciega de dos jueces; veredicto unánime de aprobar con cambios y diferir. Solo documentación: no se creó tabla, permiso ni código; no se ejecutaron pruebas.
