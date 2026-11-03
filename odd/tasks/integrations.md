# Integraciones configurables: Telegram y SMS por consulta (INT)

Diseño: [ADR 0047](../../docs/adr/0047-user-configured-integrations.md) (Aceptada, 2026-11-03). Trabajo sobre **rutas protegidas** (configuración de integraciones, secretos de integraciones y sus permisos), encargado de forma explícita por el dueño el 2026-11-03. Rama: `main` (no se crean ramas sin permiso). Estrategia de entrega: `ask-on-risk`. Pruebas: `pnpm --filter <paquete> test`, ejecutadas solo por el agente `test-runner` bajo el Finalize Pipeline.

## Especificaciones

1. "Dos tipos de notificaciones. El primero, raíz, recibe notificaciones de toda la plataforma, pero a nivel infraestructura, por ejemplo, el estado, o si algo falló, o algo que requiere atención de programación."
2. "El segundo, admin, quien recibe notificaciones interesantes como si alguien reveló una contraseña, o consultó cierta información, ingresó un nuevo login, un nuevo 2fa o lo que sea relevante" y "puede permitir establecer la configuración a otros usuarios para también recibir alertas." (cada destinatario vincula su propio chat: decisión de diseño del ADR, no pedida literalmente).
3. "Ambas habrá apartados para configurarlo."
4. SMS: "una API genérica que el usuario define configura para obtener/consultar la información, debe ser lo más genérica, personalizable y compatible con cualquier tipo de API." Primera versión: "Solo consultar."
5. Avisos con el nombre de la cuenta censurado: "mientras no filtres una contraseña o usuario, puede ir censurado" y el ejemplo `admin.admin@correo.com` → `a***.a***@c***.com`.
6. Revisión humana: se registra con el usuario de git, no con el nombre propio del dueño en las auditorías del proyecto.

## Tareas

| ID | S# | Ruta | Estado | Commit |
| --- | --- | --- | --- | --- |
| T1 | S5 | inline | hecha, 9/9 pruebas (test-runner); sin commit | |
| T2 | S1-S3 | inline | escrita; jueces A y B hechos (coinciden en 3 hallazgos, corregidos); pruebas de la corrección en curso; mutación y hoja de revisión humana pendientes | db77334 |
| T3 | S1, S2 | inline | parcial: cliente HTTPS saliente y envío a Telegram, migración 0032 (aislamiento probado), almacén de secretos cifrados, recifrador, acciones de auditoría (6 pruebas), notificador de infraestructura conectado a la cola, casos de uso `ManageTelegramIntegrations` (permiso por canal, reautenticación, auditoría), contratos zod, controlador `integrations/telegram` (sin caché) y cableado en container/módulo; tipos y lint en verde. Faltan: pruebas con base real de los repositorios Pg, entrada en la matriz de autorización e2e, hoja de revisión humana y jueces + mutación (ruta protegida) | 20449c9, 67614bb |
| T4 | S2 | inline | pendiente | |
| T5 | S4 | inline | pendiente (necesita ejemplo real de la API de Wotbi) | |
| T6 | S3 | inline | pendiente | |

- **T1** Función única de censura de identificadores, con pruebas de casos límite. Archivos nuevos.
- **T2** Permisos `alerts.infra.manage` (techo 0) y `alerts.security.manage` (techo 1): catálogo, techo, migración que redefine `permission_rank_ceiling()`, etiquetas i18n.
- **T3** Módulo de integraciones: tablas con aislamiento, secretos cifrados, recifrador, auditoría, cliente HTTP saliente seguro y canal de infraestructura por Telegram.
- **T4** Canal de seguridad: avisos desde la cola, destinatarios con vinculación propia y baja.
- **T5** SMS por consulta con asignación declarativa (completa IC-7).
- **T6** Pantallas de configuración (es-MX y en-US, tabla estándar).

## Revisión humana

Cada tarea sobre ruta protegida requiere revisión adversarial de `jd-judge-a` y `jd-judge-b`, una mutación a propósito y una hoja firmada por quien revise. Estado de cada hoja: **pendiente de revisión por el usuario de git**; nada se marca revisado sin su confirmación.

## Bitácora

- L1 (2026-11-03, original): "Tanto telegram, como recibir mensajes sms, todo es por api y definido y customizado por el usuario / me refiero a que el usuario admin de la plataforma, decide configurar sus api keys de telegram para obtener monitoreos, o el superadmin, para obtener información en algún apartado dedicado únicamente al superadmin o root / Y por parte de las notificación de sms para obtener códigos, igual, misma forma, una API genérica que el usuario define configura para obtener/consultar la información, debe ser lo más genérica, personalizable y compatible con cualquier tipo de api."
- 2026-11-03: se aprueba el plan ("Adelante!"), se definen los dos tipos de aviso, SMS solo consulta, proveedor genérico (Wotbi), censura con el ejemplo del dueño.
- 2026-11-03 T2, jueces ciegos A y B (sin hallazgos bloqueantes ni escalada de privilegios: el Administrador no puede tener `alerts.infra.manage`). Hallazgos en común, corregidos: (1) la migración 0031 no daba `alerts.infra.manage` a un rol Raíz que ya tuviera solo `alerts.security.manage`; ahora cada permiso se agrega por separado; (2) `SYSTEM_ROLES_VERSION` 5 → 6, como piden el comentario del código y las migraciones anteriores. Aceptado sin cambio: el paso de datos de la migración no tiene prueba propia (corre una sola vez al migrar); queda como riesgo anotado para la revisión humana.
- Pendiente: ejemplo real de Wotbi; árbol de trabajo de la otra sesión de IC con cambios sin commitear en `container.ts`, `app.module.ts`, `error-codes.ts` e `inbound.ts`.
- 2026-11-03 (revisión de estado, `odd/tasks/docs-inbound-sync.md`): T2 quedó en db77334 y T3 en 20449c9 y 67614bb; la documentación, en e2e3392. Los cambios sin commitear de la otra sesión de IC que se mencionan arriba ya están commiteados (hasta a63356f). Siguen pendientes los de T3, la entrada en la matriz de autorización, los jueces y la mutación, además de T4 a T6.
