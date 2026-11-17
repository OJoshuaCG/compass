# Configuración SMTP desde la web (por organización)

Objetivo: la Raíz configura el servidor SMTP de su organización desde `/alerts`; los correos de la organización salen por él y, si no hay configuración, por el entorno (respaldo). Rama: main. Entrega: commits por unidad, sin push. Ejecutor de pruebas: `~/.claude/scripts/run-tests.sh` vía `test-runner`.

## Specs

- S1. «Vamos a generar la pantalla para esta configuracion: El servidor SMTP (host, usuario, contraseña, remitente)» — pantalla web para configurarlo.
- S2. «Claro, por organizacion, es lo mejor, adelante!» — la configuración es por organización; el entorno (`MAIL_TRANSPORT`, `SMTP_*`, `MAIL_FROM`) queda como respaldo para los correos sin organización (recuperación de la Raíz, aprovisionamiento) y para organizaciones sin configuración.
- S3. Mismo patrón que el canal de Telegram: tipo `smtp_mail` en `integrations`, contraseña cifrada en `integration_secrets` (campo `smtp_password`), permiso `alerts.infra.manage` (solo Raíz), reautenticación, auditoría en la misma transacción, la contraseña nunca se devuelve (solo `hasPassword`), sin `@Idempotent` y con `no-store`.
- S4. La prueba de envío devuelve un código estable, nunca el texto del servidor SMTP.
- S5. El host SMTP no puede apuntar a destinos internos y la conexión exige TLS (supuesto, ver Log).
- S6. La contraseña entra en el recifrado de claves (`main.reencrypt`).
- S7. Una configuración nueva no deja sin correo a la organización: se prueba antes de activarla (supuesto, ver Log).

## Tasks

- T1 (S3,S6): migración 0044 + dominio + casos de uso + contratos + auditoría + controlador + recifrado. Ruta: inline. Commit: 11efebd.
- T2 (S2,S4,S5,S7): `Mailer` que resuelve la configuración por organización con respaldo de entorno; prueba de envío con guarda. Ruta: inline. Commit: 282d50a.
- T3 (S1): pantalla web, i18n es-MX/en-US, pruebas, 375 px. Ruta: inline. Commit: 2879613 (sin validación a 375 px ni e2e).
- T4: docs (ADR 0047 enmienda, database.md, deployment.md, handoff), revisión adversarial de rutas protegidas. Commit: ver Log (L5).

## Log

- L1 (2026-11-17, usuario): «Vamos a generar la pantalla para esta configuracion: El servidor SMTP (host, usuario, contraseña, remitente) no tiene pantalla. Se define con las variables MAIL_TRANSPORT=smtp, SMTP_* y MAIL_FROM en Dokploy. ADelante con la vista»
- L2 (2026-11-17, usuario): «Claro, por organizacion, es lo mejor, adelante!» (opción A: por organización con respaldo de entorno).
- L3: mapa previo (explorador): siguiente migración 0044; CHECK de `integrations.kind` e `integration_secrets.field` a ampliar; el recifrado de DEK debe incluir el secreto nuevo; los correos sin organización usan el entorno.
- L4 (2026-11-17): revisión adversarial con `jd-judge-a` y `jd-judge-b` sobre el mismo alcance congelado. Coinciden ambos en 3 hallazgos, aplicados: (1) cambiar servidor, puerto, seguridad o usuario reutilizaba la contraseña guardada: ahora la petición debe traer la nueva (contrato, caso de uso y formulario); (2) `sendTest` hacía red con la fila bloqueada: ahora lee y descifra en una transacción corta, envía fuera y audita en otra; (3) la carrera del índice único parcial devolvía un error sin mapear: ahora `insert ... on conflict do nothing` y `INTEGRATIONS.CHANNEL_ALREADY_ACTIVE`. Regla rota a propósito (se quitó la exigencia de contraseña): fallaron 3 pruebas; restaurada y en verde (77/77 en los 5 archivos dirigidos).
- L5 (supuestos y no confirmados por ambos jueces, no aplicados): lista blanca de puertos (25/465/587/2525); alerta o respaldo cuando el servidor de la organización no sirve (el outbox reintenta; archivar la configuración devuelve al del entorno); presupuesto de tiempo del manejador no cuenta DB+descifrado+DNS de `select()`; `loadManageable` de Telegram sin filtro de tipo (falla cerrado, fuera de alcance). Supuesto del dueño pendiente: la configuración nueva se activa al guardar, sin prueba obligatoria previa. No verificado: pruebas de integración del adaptador Pg, envío SMTP real, e2e y validación a 375 px.
