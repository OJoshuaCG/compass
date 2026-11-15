# Salud de credenciales (fase 1c)

Objetivo: puntaje y señales de riesgo por credencial, sin guardar nunca el secreto. Rama: `main` (sin ramas, por `CLAUDE.md`). Estrategia de entrega: commits por unidad. Pruebas: vitest por archivo vía `test-runner`.

## Specs

- S1 (`docs/business/governance.md` §3): «Cada credencial tiene un puntaje y señales de riesgo. **Nunca se guarda el secreto**; solo el resultado de la evaluación.»
- S2 (`plan.md`, «Salud de credenciales»): «Calculada al escribir (cuando el servidor tiene el texto plano) y guardada como puntaje, nunca el secreto»: «Contraseña débil (zxcvbn) o reutilizada (comparación de huellas HMAC, nunca de texto).»
- S3 (GO-10): «La salud de una credencial guarda un puntaje, nunca el secreto».
- S4 (mismo §3): señales «Antigüedad», «Sin segundo factor», «Secreto expuesto», «Correo de recuperación externo» y «Rotación pendiente».
- S5 (mismo §3): «Un panel de salud por organización, por grupo y por cuenta ayuda a priorizar qué atender primero.»
- S6 (CLAUDE.md): dependencia con versión exacta; tabla o columna nueva conserva organización, índice y política de aislamiento.

## Tareas

| ID | Spec | Ruta | Estado | Evidencia |
| --- | --- | --- | --- | --- |
| T1 | S1, S2, S3, S6 | inline | Puntaje de fortaleza al escribir (migración 0042, puerto y adaptador zxcvbn, helper compartido por crear, cambiar, restaurar e importar) | 30 pruebas de API en verde; prueba de DB de la 0042 pendiente de resultado |
| T2 | S2, S4 | inline | Caso de uso de lectura por cuenta (`GetAccountHealth`): débil, reutilizada (por huella), antigua, 2FA faltante o pendiente, expuesto, rotación pendiente. Sin «correo de recuperación externo» (L5) | 16 pruebas en verde (dominio, caso de uso, integración SQL); tsc y eslint limpios |
| T3 | S5 | inline | Endpoint y panel por organización, grupo y cuenta | pendiente |

## Log

- L1 (2026-11-14, dueño): «Sin problema instala o agrega el paquete o lo que sea del comando pnpm» y «Opcion A» (encargo de rutas protegidas para el lote). Se instaló `zxcvbn@4.4.2` y `@types/zxcvbn@4.4.5` (exactas, solo en `@iam/api`).
- L2 (2026-11-14): el puntaje se guarda en `password_fingerprints` y no en una tabla nueva, porque comparte ciclo de vida con la huella (se reemplaza en cada cambio de contraseña) y ya tiene organización, índice y aislamiento. Las filas previas quedan en null hasta que la contraseña se reescriba.
- L3 (2026-11-14): zxcvbn recorta a 100 caracteres (límite recomendado por la librería por rendimiento); una contraseña más larga se valora por su inicio.
- L4 (2026-11-14, jueces ciegos): duda 1, límite de antigüedad. Juez A eligió 90 días y juez B 180; discrepan. Se toma 90 reutilizando `PASSWORD_STALE_AFTER_DAYS` (decisión del dueño del 2026-11-02, semáforo rojo): una sola cifra para todo el producto. Es informativo y reversible; queda como supuesto en el informe final.
- L5 (2026-11-14, jueces ciegos): duda 2, «correo de recuperación externo» necesita una configuración de «dominios propios» que no existe. Ambos jueces eligieron dejar la señal fuera de esta entrega y registrarla como pendiente.
- L6 (2026-11-14): la lectura exige acceso efectivo a la cuenta (sin acceso, NOT_FOUND, igual que la ficha) y no agrega permiso nuevo; los paneles de grupo y organización (T3) necesitan decidir su permiso antes de escribirse.
