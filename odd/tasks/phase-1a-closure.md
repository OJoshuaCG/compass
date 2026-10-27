# Cierre de la Fase 1a · Identidad

Objetivo: dejar la Fase 1a completa según sus criterios de salida del plan antes de abrir la bóveda (1b). Es el siguiente trabajo recomendado; el detalle y el orden están en [`docs/handoff.md`](../../docs/handoff.md), sección 4, bloque A. Método: el mismo de `phase-1a-identity.md` (iteraciones hasta 5, revisión adversarial ciega, mutación manual, commits convencionales por parte).

## Specs

Las especificaciones salen de las secciones "Autenticación del propio sistema", "Actores y jerarquía: reglas formales" y "Modelo de autorización" del plan, y de la bitácora L6 y L10 de `phase-1a-identity.md`. Textuales del plan que esta tarea cierra:

- S1. "Passkeys (WebAuthn): preferidas; resistentes a phishing. Se permiten varias por usuario con nombre". Política "exigir passkeys para Raíz y Administradores".
- S2. Reglas 5 a 7 de jerarquía: cambio de rango, transferencia de responsable y bajas con reasignación; "Desactivar, suspender, cambiar rango o roles revoca las sesiones del afectado en el acto".
- S3. "Al crear la organización se generan códigos de emergencia, impresos y custodiados por dos personas fuera del sistema. Usarlos alerta a todos los Administradores y queda auditado."
- S4. "El usuario ve y cierra sus sesiones activas; su responsable puede cerrarlas todas."
- S5. "Reenviar una invitación invalida la anterior." Roles personalizados con "Sus permisos deben ser un subconjunto de los de su creador".
- S6. "Idempotency-Key obligatorio en POST que crean recursos; se guarda la respuesta 24 horas."
- S7. Contraseña inicial de la Raíz con cambio obligatorio (el indicador ya existe y no se aplica).

## Tasks

| ID | Specs | Ruta | Estado |
| --- | --- | --- | --- |
| A1 Gestión de personas (rango, responsable, suspender, desactivar, revocar sesiones) | S2 | pendiente | pendiente |
| A2 Passkeys y política para Raíz y Administradores | S1 | pendiente | pendiente |
| A3 Alta de organizaciones como comando de operaciones + códigos de emergencia | S3 | pendiente | pendiente |
| A4 Cambio obligatorio de la contraseña inicial de la Raíz | S7 | pendiente | pendiente |
| A5 Sesiones: ver, cerrar, cierre por el responsable, sincronización entre pestañas | S4 | pendiente | pendiente |
| A6 Reenvío de invitación y roles personalizados | S5 | pendiente | pendiente |
| A7 Idempotencia de las peticiones de creación | S6 | pendiente | pendiente |
| A8 Redis para límites de intentos y correo real | — | pendiente | pendiente (requiere decisión de proveedor) |
| A9 Ejecutar el CI en GitHub y añadir escáneres de seguridad | — | pendiente | pendiente |
| A10 Reautenticación en navegador real y con código de recuperación | — | pendiente | pendiente (depende de A1) |

## Log

- L1 (2026-10-27): Tarea creada a partir del análisis de continuidad. Se corrigió además un defecto hallado al probar la pila local: la comprobación de vida de la API respondía 401 con sesión activa (ahora es pública, con prueba de regresión). Se añadió `pnpm stack` para levantar la plataforma completa a mano.
