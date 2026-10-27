# Modelo de amenazas (borrador de la fase 0)

> **Borrador de la fase 0.** Este documento se revisa en cada fase, antes de abrir la siguiente, y antes del pentest externo y de cada fase de SSO. Las mitigaciones listadas provienen de [`plan.md`](../plan.md); el campo "Estado" refleja si existe en el código o está planeada. No sustituye al pentest externo ni a la revisión humana de rutas protegidas.

Tipo de documento: referencia y análisis. Metodología: STRIDE por módulo (Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege).

## Contenido

1. [Alcance y supuestos](#1-alcance-y-supuestos)
2. [Actores de amenaza](#2-actores-de-amenaza)
3. [Activos principales](#3-activos-principales)
4. [STRIDE por módulo](#4-stride-por-módulo)
5. [Amenazas transversales](#5-amenazas-transversales)
6. [Riesgos residuales y huecos conocidos](#6-riesgos-residuales-y-huecos-conocidos)
7. [Revisión](#7-revisión)

## 1. Alcance y supuestos

- Alcance: la fase 1 (identidad, bóveda con 2FA y gobernanza) y los cimientos de la fase 0. Los módulos `federation`, `inbound-codes` y `broker` quedan fuera hasta sus fases.
- Una organización en producción; multitenancy preparada ([ADR 0006](adr/0006-multitenancy-ready-rls.md)).
- El producto guarda secretos reales de plataformas externas (redes sociales) y el 2FA de la organización.
- Cifrado del lado del servidor con KMS ([ADR 0004](adr/0004-server-side-encryption-kms-per-org-dek.md)): el servidor puede abrir secretos, por lo que su compromiso es el escenario de mayor impacto.
- Nube de referencia AWS con confirmación pendiente ([ADR 0020](adr/0020-reference-cloud-aws.md)).

## 2. Actores de amenaza

| Actor | Capacidad | Ejemplo |
| --- | --- | --- |
| Externo no autenticado | Internet; sin credenciales | Fuerza bruta de login, phishing, enumeración de usuarios |
| Usuario legítimo malicioso (abuso interno) | Cuenta válida con acceso parcial | Operador que copia todo lo que puede ver |
| Usuario con cuenta comprometida | Sesión o credenciales robadas | Phishing exitoso sobre un Líder |
| Administrador de base de datos o de nube | Acceso a la base de datos o al respaldo | Lectura o reescritura de tablas, copia de respaldos |
| Servidor comprometido | Ejecución de código con rol IAM del servicio | Uso directo del KMS |
| Dependencia comprometida (cadena de suministro) | Código en API o SPA | Paquete npm malicioso |
| Código generado con errores sutiles | Cambio aprobado que parece correcto | Autorización omitida en un caso de uso |

## 3. Activos principales

| Activo | Dónde vive | Por qué importa |
| --- | --- | --- |
| Secretos de credenciales (usuario, contraseña, `totp_uri`, códigos de recuperación, notas) | `credential_secrets` (cifrados) | Acceso a cuentas de plataformas |
| KEK y DEK | KMS y `data_keys` (`wrapped_dek`); DEK en memoria del proceso | Abren todos los secretos |
| Sesiones, tokens de invitación y de handoff | `sessions`, `invitations`, `totp_handoffs` (solo hash) | Suplantación de identidad |
| Hashes de contraseña, factores y códigos de recuperación | `user_passwords`, `webauthn_credentials`, `user_totp_factors`, `user_recovery_codes` | Acceso al propio sistema |
| Cadena de auditoría | `audit_events`, archivo inmutable | Evidencia y detección |
| Jerarquía y permisos | `users`, `roles`, `user_roles`, `shares` | Define quién ve qué |
| Códigos de emergencia de la Raíz | Fuera del sistema, custodiados por dos personas | Recuperación de la Raíz |

## 4. STRIDE por módulo

Convención del campo **Estado**: **Planeada** (aún no existe en el código) o **Implementada** (existe y tiene prueba). Al cierre de la fase 0 solo puede estar implementada la parte de los cimientos (contexto de organización, `crypto`, `audit`, RLS); cada fila debe actualizarse al verificarla. Mientras no se verifique en el código, se marca **Planeada**.

### 4.1 `identity` (protegido)

Activos: contraseñas (Argon2id), passkeys, TOTP propio, códigos de recuperación, sesiones, invitaciones.

| STRIDE | Amenaza | Mitigación (plan) | Estado |
| --- | --- | --- | --- |
| S | Fuerza bruta o relleno de credenciales en login, MFA o recuperación | Rate limiting por cuenta y por IP; retraso progresivo; bloqueo temporal (no permanente) | Planeada (fase 1a) |
| S | Phishing de contraseña y segundo factor | MFA obligatorio, passkeys preferidas (resistentes a phishing); sin SMS ni correo como factor | Planeada (fase 1a) |
| S | Enumeración de usuarios | Mensajes y tiempos idénticos para usuario inexistente o contraseña incorrecta | Planeada (fase 1a) |
| S | Robo de cookie de sesión | `__Host-session` `HttpOnly`, `Secure`, `SameSite=Lax`; token de 256 bits con solo su SHA-256 en base de datos; sin tokens en `localStorage` | Planeada (fase 1a) |
| T | CSRF | `SameSite`, cabecera `X-Requested-With` y verificación de `Origin` | Planeada (fase 1a) |
| R | Negar un cambio de factores o un restablecimiento | Auditoría de cambios; avisos por correo ante dispositivo nuevo y cambios de contraseña o factores | Planeada (fase 1a y 1c) |
| I | Filtración de hashes o tokens en logs | Redacción en `pino`; tokens solo como hash; prueba de logs con secretos conocidos | Planeada (fase 0 a 1a) |
| D | Bloqueo malicioso de cuentas | Bloqueo temporal y no permanente | Planeada (fase 1a) |
| E | Alta de usuario con rango o roles mayores al permitido | Matriz de creación validada en el dominio; no escalamiento ([ADR 0012](adr/0012-no-permission-escalation.md)); invitación de un solo uso de 72 horas | Planeada (fase 1a) |
| E | Recuperación de acceso abusada para tomar una cuenta | Restablecimiento de factores solo por responsable o Raíz, con reautenticación y motivo; usar un código de recuperación notifica al usuario y a su responsable | Planeada (fase 1a) |
| — | Acceso previo a la autenticación bajo RLS (login, token de invitación, sesión) | Hueco abierto: [ADR 0021](adr/0021-pre-authentication-access-with-rls.md) (Propuesta) | Pendiente de decisión |

### 4.2 `access` (protegido)

Activos: catálogo de permisos, roles, comparticiones, motor de decisión.

| STRIDE | Amenaza | Mitigación (plan) | Estado |
| --- | --- | --- | --- |
| S | Actor con sesión inválida o inactivo ejecuta una acción | Paso 2 del motor: actor activo y sesión válida | Planeada (fase 1a) |
| T | Edición de roles de sistema o de permisos fuera de catálogo | Plantillas del sistema no editables; catálogo en código (`enum` versionado) | Planeada (fase 1a) |
| R | Negación sin rastro | Las negaciones también se auditan con su código de motivo ([ADR 0016](adr/0016-append-only-audit-hash-chain.md)); escritura independiente pendiente ([ADR 0022](adr/0022-audit-of-denials-in-independent-transaction.md)) | Planeada; parcialmente abierta |
| I | Listados que revelan recursos sin acceso | Filtro en SQL con la vista `effective_access`; `404` en lugar de `403` cuando corresponde | Planeada (fase 1a y 1b) |
| D | Evaluaciones costosas del subárbol | Cálculo en SQL; índices que empiezan por `organization_id` | Planeada (fase 1a) |
| E | IDOR o escalamiento de privilegios | Motor único de 7 pasos; dos puntos de control (guard y caso de uso); matriz de autorización exhaustiva; mutación con Stryker; no escalamiento; techos por rango | Planeada (fase 1a) |
| E | Gestión de personas usada para llegar a secretos | Ningún rango da acceso a secretos; solo compartición explícita; acceso de emergencia con motivo, reautenticación, 1 hora y alerta crítica ([ADR 0010](adr/0010-managing-people-grants-no-secret-access.md)) | Planeada (fase 1a y 1b) |
| E | Comparticiones vencidas que siguen vigentes | Un job las vence y el motor también las ignora | Planeada (fase 1b) |

### 4.3 `vault`

Activos: plataformas, cuentas, credenciales, versiones de secretos, comparticiones.

| STRIDE | Amenaza | Mitigación (plan) | Estado |
| --- | --- | --- | --- |
| S | Usuario se hace pasar por otro al compartir | Sesión y reautenticación en acciones sensibles; compartición solo con MANAGE | Planeada (fase 1b) |
| T | Copiar texto cifrado de una credencial a otra | AAD (`org_id`, `credential_id`, `field`, `version`) en AES-256-GCM | Planeada (fase 0, en `crypto`) |
| T | Edición concurrente que pisa cambios | Concurrencia optimista (`version`, `If-Match`); `409` | Planeada (fase 1b) |
| R | Negar una revelación | Reautenticación, motivo escrito y auditoría de cada revelación; auditoría ligera al copiar usuario | Planeada (fase 1b) |
| I | Secreto en listados, detalle, logs o caché del navegador | El secreto solo viaja en la respuesta dedicada con `Cache-Control: no-store`; redacción de logs; secretos solo en estado local del componente | Planeada (fase 1b) |
| I | Abuso interno: usuario legítimo copia todo | Nivel USE sin revelar; límite de revelaciones por usuario y hora con alerta; motivos; JIT; rotación en bajas | Planeada (fase 1b y 1c) |
| I | Correo de recuperación y usuario de plataforma expuestos en la base | Todo cifrado, incluido el usuario; índice ciego (HMAC) para búsquedas exactas | Planeada (fase 1b) |
| D | Importación CSV masiva | El archivo se procesa en memoria con previsualización y validación | Planeada (fase 1b) |
| E | Acceso a una cuenta sin el nivel requerido | Permiso **y** nivel de compartición; nadie comparte un nivel superior al suyo | Planeada (fase 1b) |

### 4.4 `totp`

Activos: secretos TOTP de plataformas, tokens de handoff.

| STRIDE | Amenaza | Mitigación (plan) | Estado |
| --- | --- | --- | --- |
| S | Atacante usa un enlace de handoff capturado o fotografiado | Token de 256 bits, un solo uso, 5 minutos, ligado a usuario y credencial; solo su hash en base de datos; el enlace nunca se envía por correo ni chat | Planeada (fase 1b) |
| T | Inyección de un secreto TOTP ajeno vía handoff | El usuario confirma emisor y etiqueta en el escritorio antes de guardar | Planeada (fase 1b) |
| T | URI con parámetros peligrosos | Validación estricta (tipo `totp`, algoritmo, dígitos, periodo, Base32 de al menos 128 bits); HOTP rechazado | Planeada (fase 1b) |
| R | Negar la exportación del secreto | Exportar exige MANAGE, `credential.export_totp`, reautenticación, motivo y evento crítico; marca "secreto expuesto" | Planeada (fase 1b) |
| I | El navegador conserva el secreto | Los códigos se generan en el servidor; el navegador recibe 6 dígitos ([ADR 0013](adr/0013-server-side-totp-generation.md)); el QR se decodifica en el cliente y no se sube la imagen | Planeada (fase 1b) |
| D | Abuso del endpoint de códigos | Rate limit por usuario y credencial | Planeada (fase 1b) |
| D | Deriva de reloj que invalida códigos | NTP y alerta si la deriva supera 2 segundos | Planeada (fase 1b) |
| E | Obtener códigos sin nivel USE | `POST /credentials/:id/totp-code` exige USE y `credential.use_totp` | Planeada (fase 1b) |

### 4.5 `crypto` (protegido)

Activos: KEK (en el KMS), DEK (cifrada en `data_keys` y en memoria), índices ciegos.

| STRIDE | Amenaza | Mitigación (plan) | Estado |
| --- | --- | --- | --- |
| S | Adaptador local de claves usado en producción | `LocalKeyManagement` se niega a arrancar si `NODE_ENV=production` | Planeada (fase 0) |
| T | Nonce reutilizado o texto cifrado alterado | Nonce aleatorio de 12 bytes por operación; GCM autentica con tag de 16 bytes; pruebas negativas (AAD alterado, truncado, DEK incorrecta) | Planeada (fase 0) |
| R | Uso del KMS sin rastro | Registros del proveedor del KMS y métricas de llamadas; monitoreo de uso | Planeada (fase 1c / operación) |
| I | DEK expuesta por volcado, log o Redis | Caché solo en memoria del proceso con TTL de 10 minutos y 10 000 usos; el `Buffer` se pone a ceros al expulsar (mejor esfuerzo); nunca en Redis, disco ni logs ([ADR 0005](adr/0005-in-memory-dek-cache.md)) | Planeada (fase 0) |
| I | Otro módulo usa primitivas criptográficas directamente | Solo `SecretCipher`; `no-restricted-imports` para `node:crypto` fuera de `crypto` | Planeada (fase 0) |
| D | KMS caído o saturado | DEK en caché sirven hasta su TTL; single-flight; después, falla cerrada solo para descifrar; alerta por errores del KMS | Planeada (fase 0 y operación) |
| D | Pérdida o borrado de la KEK | Protección contra borrado (ventana de 30 días), alertas ante solicitud de borrado o deshabilitación, simulacro trimestral de restauración | Planeada (operación) |
| E | Servidor comprometido con acceso al KMS | IAM mínimo (solo el rol del servicio usa `Decrypt` y `GenerateDataKey`), red privada, monitoreo, rotación de DEK y runbook ([servidor comprometido](runbooks/compromised-user-or-server-response.md)) | Planeada (operación) |

### 4.6 `audit` (protegido)

Activos: `audit_events`, cadena de hashes, archivo inmutable.

| STRIDE | Amenaza | Mitigación (plan) | Estado |
| --- | --- | --- | --- |
| S | Evento con actor falso | El actor sale del `RequestContext` autenticado, nunca del cliente | Planeada (fase 0) |
| T | Reescritura de la historia por administrador de base de datos | Rol de aplicación con solo `INSERT` y `SELECT`; encadenamiento de hashes; verificación diaria; exportación a almacenamiento inmutable (Object Lock) | Planeada (fase 0 y 1c) |
| T | Bifurcación de la cadena por escrituras concurrentes | Advisory lock por organización; prueba de cadena tras operaciones concurrentes (impacto en transacciones largas: [ADR 0023](adr/0023-audit-advisory-lock-and-long-transactions.md), Propuesta) | Planeada (fase 0) |
| R | Acciones sensibles sin evidencia | Auditoría en la misma transacción; si falla, la acción falla (falla cerrada) | Planeada (fase 0) |
| I | Secretos en eventos de auditoría | Nunca secretos, ni parciales; `metadata` con lista blanca de campos | Planeada (fase 0) |
| D | Ráfaga de negaciones o de eventos satura la tabla o el lock | Rate limiting; agrupación pendiente de decisión ([ADR 0022](adr/0022-audit-of-denials-in-independent-transaction.md)) | Pendiente de decisión |
| D | Imposibilidad de expirar eventos con `DELETE` revocado | Hueco abierto: [ADR 0024](adr/0024-audit-retention-vs-revoke-delete.md) (Propuesta) | Pendiente de decisión |
| E | Rol de aplicación con permisos de más sobre `audit_events` | Pruebas que verifican que `UPDATE` y `DELETE` están revocados | Planeada (fase 0) |

### 4.7 `governance`

Activos: tareas de rotación, salud de credenciales, solicitudes de acceso temporal (JIT).

| STRIDE | Amenaza | Mitigación (plan) | Estado |
| --- | --- | --- | --- |
| S | Solicitud de acceso temporal a nombre de otro | Sesión y rol del solicitante; motivo y duración obligatorios | Planeada (fase 1c) |
| T | Aprobación sin autoridad | Aprobación solo con MANAGE sobre la cuenta y `access_request.approve`; la compartición temporal tiene `expires_at` | Planeada (fase 1c) |
| R | Negar una baja o su exposición | `DeactivateUser` emite evento de auditoría crítico con resumen; solicitud, decisión, uso y vencimiento quedan auditados | Planeada (fase 1c) |
| I | Exposición no detectada de credenciales de quien se va | Cálculo de exposición a partir de la auditoría de 180 días y una tarea de rotación por credencial expuesta | Planeada (fase 1c) |
| D | Tareas de rotación vencidas sin atender | Panel de rotaciones, alerta de severidad media por tareas vencidas | Planeada (fase 1c) |
| E | Acceso temporal que no vence | Un job retira la compartición y el motor también la ignora al evaluar | Planeada (fase 1c) |

### 4.8 `notification`

Activos: correos (invitaciones, alertas), canal SSE, contenido de alertas críticas.

| STRIDE | Amenaza | Mitigación (plan) | Estado |
| --- | --- | --- | --- |
| S | Correo falso que imita invitaciones o alertas | DKIM del dominio de envío; enlace de invitación de un solo uso, 72 horas, con hash en base de datos; el invitado define su contraseña, quien invita nunca la conoce | Planeada (fase 1a) |
| T | Alteración de eventos SSE | Canal bajo el mismo origen, sesión autenticada y TLS; eventos filtrados por organización y usuario | Planeada (fase 1b) |
| R | Alertas críticas no entregadas | Notificación en tiempo real a la Raíz y a los gestores del recurso; la auditoría conserva el evento aunque falle la notificación | Planeada (fase 1c) |
| I | Secretos o datos sensibles en correos y SSE | Los correos no incluyen secretos; los enlaces de handoff nunca se envían por correo; redacción de logs | Planeada (fase 1a a 1c) |
| D | Inundación de correos o eventos | Rate limiting en invitaciones; envío por cola en el worker | Planeada (fase 1a) |
| E | Cambiar el idioma o destinatario para suplantar | Correos traducidos con el idioma del destinatario guardado en su perfil; el destinatario sale de datos del dominio, no de la petición | Planeada (fase 1a) |

## 5. Amenazas transversales

| Amenaza | Mitigación (plan) | Estado |
| --- | --- | --- |
| Fuga entre organizaciones | Tres capas: contexto, RLS y claves por organización; suite de aislamiento por repositorio y por endpoint de listado en cada PR | Planeada (fase 0, RLS y contexto) |
| Dependencia npm comprometida | Versiones exactas, lockfile, espera de 7 días (`minimumReleaseAge`), scripts de instalación deshabilitados con lista blanca, aprobación humana de nuevas dependencias, CSP estricta, Trusted Types | Implementada parcialmente en la configuración del repositorio (`pnpm-workspace.yaml`); resto planeada |
| Código generado por IA con errores sutiles | `CODEOWNERS`, dos revisores en rutas protegidas, `CLAUDE.md`, pruebas de matriz escritas o revisadas por personas, revisores independientes | Planeada (`CODEOWNERS` pendiente) |
| XSS o clickjacking en la SPA | CSP sin `unsafe-inline` ni `unsafe-eval`, `frame-ancestors 'none'`, Trusted Types, sin `dangerouslySetInnerHTML` | Planeada (fase 0 a 1a) |
| Compromiso de la Raíz o pérdida de acceso | Códigos de emergencia custodiados por dos personas; transferencia con 72 horas de espera y aviso; alertas críticas ([runbook](runbooks/transfer-root.md)) | Planeada (fase 1a y 1c) |
| Fuga de la base de datos | Secretos cifrados con DEK protegida por KMS; el AAD impide reubicar texto cifrado | Planeada (fase 0); [runbook](runbooks/data-breach-response.md) |
| Falta de recuperación tras caída o desastre | PITR, snapshots entre regiones, RPO y RTO iniciales a validar, simulacro trimestral ([restaurar respaldo](runbooks/restore-backup.md)) | Planeada (gate de producción) |

## 6. Riesgos residuales y huecos conocidos

- **Servidor comprometido con acceso al KMS**: lee todos los secretos; solo se reduce con IAM mínimo, monitoreo y rotación. No existe una mitigación criptográfica adicional en el diseño actual.
- **Usuario legítimo malicioso**: el nivel USE protege contra exposición casual del secreto, pero un usuario decidido con acceso puede obtener lo que el cliente use (limitación reconocida del enfoque de extensión en el plan, fases 6 y 7).
- **Borrado de memoria**: Node no garantiza el borrado de memoria; el TTL corto de la caché de DEK es la mitigación.
- **Huecos de diseño en estado Propuesta**: [ADR 0021](adr/0021-pre-authentication-access-with-rls.md), [0022](adr/0022-audit-of-denials-in-independent-transaction.md), [0023](adr/0023-audit-advisory-lock-and-long-transactions.md) y [0024](adr/0024-audit-retention-vs-revoke-delete.md).
- **Decisiones pendientes del equipo** que afectan a este modelo: proveedor de nube, política de retención validada con legal, exigir passkeys a Raíz y Administradores, y custodios de los códigos de emergencia (ver "Decisiones pendientes del equipo" en el plan).
- **Pentest externo**: no realizado; es requisito del gate de producción y no se cargan credenciales reales hasta cerrar los hallazgos altos y críticos.

## 7. Revisión

| Cuándo | Qué se revisa |
| --- | --- |
| Al cerrar cada fase | Actualizar el estado (Planeada a Implementada) con evidencia en código o pruebas |
| Al abrir una fase con nuevos módulos (2 a 7) | Añadir las secciones de `federation`, `inbound-codes` y `broker` |
| Antes del pentest externo | Que el alcance del pentest cubra los puntos de este modelo |
| Tras un incidente | Registrar el escenario y la mitigación |
| Al aceptar un ADR en estado Propuesta | Actualizar la fila "Pendiente de decisión" correspondiente |
