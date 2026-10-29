# Modelo de amenazas (borrador de la fase 0)

> **Borrador de la fase 0, actualizado con la fase 1a en los módulos `identity` y `access`.** Este documento se revisa en cada fase, antes de abrir la siguiente, y antes del pentest externo y de cada fase de SSO. Las mitigaciones listadas provienen de [`plan.md`](../plan.md); el campo "Estado" refleja si existe en el código o está planeada. No sustituye al pentest externo ni a la revisión humana de rutas protegidas.

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
| Hashes de contraseña, factores y códigos de recuperación | `user_passwords`, `webauthn_credentials`, `user_totp_factors`, `user_recovery_codes`, `webauthn_challenges` | Acceso al propio sistema |
| Cadena de auditoría | `audit_events`, archivo inmutable | Evidencia y detección |
| Jerarquía y permisos | `users`, `roles`, `user_roles`, `shares` | Define quién ve qué |
| Códigos de emergencia de la Raíz | Impresos y custodiados fuera del sistema por dos personas; en el sistema solo su hash (`user_recovery_codes`, `kind = 'emergency'`) | Recuperación de la Raíz |

## 4. STRIDE por módulo

Convención del campo **Estado**: **Planeada** (aún no existe en el código) o **Implementada** (existe y tiene prueba). Al cierre de la fase 0 solo estaba implementada la parte de los cimientos (contexto de organización, `crypto`, `audit`, RLS). Con la fase 1a se actualizaron las filas de `identity` y `access` que ya existen y tienen pruebas de punta a punta contra PostgreSQL real; la evidencia se indica a nivel de comportamiento. Cuando una mitigación se cumple solo en parte, la fila separa lo implementado de lo que sigue **Planeada**. Mientras no se verifique en el código, se marca **Planeada**. Las filas de los demás módulos no se han revisado en esta actualización.

### 4.1 `identity` (protegido)

Activos: contraseñas (Argon2id), passkeys, TOTP propio, códigos de recuperación, sesiones, invitaciones.

| STRIDE | Amenaza | Mitigación (plan) | Estado |
| --- | --- | --- | --- |
| S | Fuerza bruta o relleno de credenciales en login, MFA o recuperación | Rate limiting por cuenta y por IP; retraso progresivo; bloqueo temporal (no permanente) | **Implementada** (fase 1a): espera creciente desde el tercer fallo, bloqueo de 15 minutos tras 10 intentos y recuperación al vencer; una ráfaga de códigos erróneos en paralelo no supera el bloqueo (se evalúan como máximo diez, [ADR 0026](adr/0026-atomic-failed-attempt-counting.md)); el límite por IP se aplica también a rutas con caracteres codificados. **Planeada:** contadores compartidos en Redis; hoy son por instancia y se pierden al reiniciar |
| S | Phishing de contraseña y segundo factor | MFA obligatorio, passkeys preferidas (resistentes a phishing); sin SMS ni correo como factor | **Implementada en parte** (fase 1a): el segundo factor es obligatorio (una contraseña correcta solo abre una sesión parcial) y no se usan SMS ni correo. Las passkeys (WebAuthn, con verificación de usuario obligatoria y sin atestación) resisten el phishing y son una alternativa completa al TOTP, que no lo resiste. Son opcionales para todos: mientras una persona use TOTP, el riesgo de phishing sobre ese factor sigue. **Planeada:** exigir passkeys a la Raíz y a los Administradores como configuración de la organización (aún no hay pantalla de configuración); su revisión ciega ya se hizo y sus hallazgos están corregidos |
| S | Autenticador de passkey clonado o desafío reutilizado | Contador de firmas que debe avanzar; desafío aleatorio de un solo uso, de 5 minutos y ligado a la persona y al propósito | **Implementada** (fase 1a): un contador de firmas que no avanza se rechaza; el desafío (`webauthn_challenges`, con RLS) no valida otra ceremonia ni se puede usar dos veces; los fallos comparten el límite de intentos de la persona y pedir el desafío no cuenta como intento; agregar o quitar una passkey exige reautenticación reciente; las respuestas nunca incluyen claves; máximo 10 por persona; altas, bajas e ingresos se auditan (`auth.passkey_registered`, `auth.passkey_revoked`, `auth.passkey_login`) |
| S | Enumeración de usuarios | Mensajes y tiempos idénticos para usuario inexistente o contraseña incorrecta | **Implementada** (fase 1a): mismo estado y mismo cuerpo para correo inexistente y contraseña incorrecta, con una verificación de costo equivalente; el intento fallido de un usuario conocido se audita fuera del camino de la respuesta para que no cambie el tiempo; una invitación inexistente, vencida o usada se ve igual |
| S | Robo de cookie de sesión | `__Host-session` `HttpOnly`, `Secure`, `SameSite=Lax`; token de 256 bits con solo su SHA-256 en base de datos; sin tokens en `localStorage` | **Implementada** (fase 1a): cookie con esos atributos y sin dominio; en base de datos solo vive el hash; cerrar sesión la revoca en el servidor y la cookie robada deja de servir; la sesión caduca a los 30 minutos de inactividad y a las 12 horas absolutas; una persona suspendida pierde su sesión |
| T | CSRF | `SameSite`, cabecera `X-Requested-With` y verificación de `Origin` | **Implementada** (fase 1a): una petición que modifica sin la cabecera personalizada o desde otro origen se rechaza |
| R | Negar un cambio de factores o un restablecimiento | Auditoría de cambios; avisos por correo ante dispositivo nuevo y cambios de contraseña o factores | **Implementada en parte** (fase 1a): quedan auditados el ingreso, la verificación y el fallo del segundo factor, el alta del factor, el uso de un código de recuperación, la reautenticación y el cierre de sesión. **Planeada:** avisos por correo y el restablecimiento de factores (fase 1c) |
| I | Filtración de hashes o tokens en logs | Redacción en `pino`; tokens solo como hash; prueba de logs con secretos conocidos | **Implementada en parte** (fase 1a): tokens, secretos de segundo factor y códigos de recuperación se guardan cifrados o solo como hash, y una prueba comprueba que la auditoría no recibe contraseñas, tokens ni códigos; el enlace de invitación viaja en el fragmento de la URL para no quedar en los registros de acceso. **Planeada:** la prueba de logs de aplicación con secretos conocidos en todos los endpoints sensibles. Nota: el adaptador de correo de desarrollo escribe el enlace en el registro y se niega a arrancar en producción |
| D | Bloqueo malicioso de cuentas | Bloqueo temporal y no permanente | **Implementada** (fase 1a): el bloqueo dura 15 minutos y se levanta solo; no hay bloqueo permanente |
| E | Alta de usuario con rango o roles mayores al permitido | Matriz de creación validada en el dominio; no escalamiento ([ADR 0012](adr/0012-no-permission-escalation.md)); invitación de un solo uso de 72 horas | **Implementada** (fase 1a): nadie crea a su mismo rango ni superior y nadie invita a la Raíz; no se otorgan roles con permisos que no se tienen; el enlace es de un solo uso y vence a las 72 horas; dos aceptaciones simultáneas crean un solo usuario; al aceptar se revalida que el rol exista, que quien invitó siga activo y conserve el rango y el permiso; cada negación queda auditada |
| E | Recuperación de acceso abusada para tomar una cuenta | Restablecimiento de factores solo por responsable o Raíz, con reautenticación y motivo; usar un código de recuperación notifica al usuario y a su responsable | **Implementada en parte.** Un código de recuperación es de un solo uso y queda auditado; un segundo factor ya verificado no puede reemplazarse desde una sesión parcial. Recuperación de la Raíz implementada (ver la fila siguiente); **planeados:** el restablecimiento de factores por el responsable y el aviso por correo del uso de un código de recuperación |
| E | Uso indebido de un código de emergencia de la Raíz para tomar la cuenta de mayor privilegio | Códigos custodiados fuera del sistema por dos personas; el código no sustituye la contraseña; evento crítico y alerta a todos los Administradores; ningún Administrador puede restablecer la Raíz (decisión del dueño, 2026-10-27) | **Implementada** (fase 1a): 8 códigos de un solo uso, solo como hash, impresos una vez; usar uno exige antes la contraseña, restablece el segundo factor de la Raíz (TOTP y códigos ordinarios revocados), degrada la sesión que lo usó a registro pendiente, cierra sus demás sesiones, audita `auth.emergency_code_used` (con el número de destinatarios) y envía correo a cada Administrador activo tras el *commit*; si el correo falla o no hay destinatarios se audita `auth.emergency_alert_incomplete`. Los códigos sin usar siguen vigentes. **Hueco conocido:** el alerta depende del correo, y quien tenga un código y la contraseña puede restablecer el factor de la Raíz. **Planeada:** un procedimiento de operaciones para quien olvida la contraseña y pierde los factores |
| E | Contraseña inicial de la Raíz puesta por operaciones | Cambio obligatorio en el primer ingreso; registro del alta en la auditoría | **Implementada** (fase 1a): el ingreso con la contraseña inicial exige cambiarla antes de registrar el segundo factor, y el alta de la organización se audita (`organization.provisioned`) |
| — | Acceso previo a la autenticación bajo RLS (login, token de invitación, sesión) | Funciones de lectura mínimas y controladas: [ADR 0021](adr/0021-pre-authentication-access-with-rls.md) (Aceptada) | **Implementada** (fase 1a): el rol de la aplicación sigue sin saltarse RLS y solo ejecuta esas funciones antes de conocer la organización. Una prueba comprueba que un usuario de otra organización no puede reutilizar una sesión ajena |
| T | Reintento o reutilización de una clave de idempotencia para repetir o alterar una creación | Clave obligatoria por organización, actor y petición; misma clave con otra petición se rechaza (`IDEMPOTENCY.KEY_REUSED`) | **Implementada** (fase 1a): la reserva vence al minuto y su toma es atómica, así que una petición lenta no sobrescribe a un dueño más reciente. **Limitaciones:** el reintento dentro de las 24 horas no vuelve a comprobar permisos. Las filas vencidas las borra la purga programada (ADR 0038). No se usa en endpoints cuya respuesta lleve secretos |
| E | Sesión robada que sigue viva | La persona ve y cierra sus otras sesiones; su responsable cierra todas | **Implementada** (fase 1a): `auth.session_revoked` y `user.sessions_revoked` quedan auditados; la Raíz está protegida del cierre masivo |

### 4.2 `access` (protegido)

Activos: catálogo de permisos, roles, comparticiones, motor de decisión.

| STRIDE | Amenaza | Mitigación (plan) | Estado |
| --- | --- | --- | --- |
| S | Actor con sesión inválida o inactivo ejecuta una acción | Paso 2 del motor: actor activo y sesión válida | **Implementada** (fase 1a): una persona que no está activa (por ejemplo, invitada que aún no completa su alta) o sin sesión es negada con el motivo de sesión; una sesión revocada, vencida o inactiva no autentica |
| T | Edición de roles de sistema o de permisos fuera de catálogo | Plantillas del sistema no editables; catálogo en código (`enum` versionado) | **Implementada** (fase 1a): el catálogo de 27 permisos es fijo y las plantillas se siembran desde código con versión; no existe ningún camino para editarlas. La edición de roles personalizados sigue **Planeada** |
| R | Negación sin rastro | Las negaciones también se auditan con su código de motivo ([ADR 0016](adr/0016-append-only-audit-hash-chain.md)); escritura independiente ([ADR 0022](adr/0022-audit-of-denials-in-independent-transaction.md)) | **Implementada** (fase 1a): cada negación deja un rastro con su código de motivo aunque la acción completa se revierta; también las que deciden reglas de negocio fuera del motor (matriz de creación y no escalamiento). **Planeada:** agrupar o limitar las negaciones repetidas y definir qué ocurre si esa escritura falla |
| I | Listados que revelan recursos sin acceso | Filtro en SQL con la vista `effective_access`; `404` en lugar de `403` cuando corresponde | **Implementada en parte** (fase 1a): el directorio solo lista personas activas y solo con nombre, correo y rango, y aísla por organización. **Planeada:** el filtro por la vista de acceso efectivo llega con los listados de la bóveda (fase 1b) |
| D | Evaluaciones costosas del subárbol | Cálculo en SQL; índices que empiezan por `organization_id` | **Implementada** (fase 1a): el subárbol se calcula en una consulta recursiva que corta ciclos. Sin medición de rendimiento a escala |
| E | IDOR o escalamiento de privilegios | Motor único de 7 pasos; dos puntos de control (guard y caso de uso); matriz de autorización exhaustiva; mutación con Stryker; no escalamiento; techos por rango | **Implementada en parte** (fase 1a): el motor evalúa organización, sesión, permiso, jerarquía y contexto (reautenticación vigente) y niega por defecto; la matriz de jerarquía y los techos de rango de los 27 permisos tienen pruebas; el no escalamiento se aplica al invitar y al aceptar. **Planeada:** el paso de compartición (fase 1b), el guard de permisos como primera barrera, la mutación con Stryker y las acciones de gestión de personas |
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
| T | Bifurcación de la cadena por escrituras concurrentes | Advisory lock por organización; prueba de cadena tras operaciones concurrentes (impacto en transacciones largas: [ADR 0023](adr/0023-audit-advisory-lock-and-long-transactions.md), Aceptada) | Planeada (fase 0) |
| R | Acciones sensibles sin evidencia | Auditoría en la misma transacción; si falla, la acción falla (falla cerrada) | Planeada (fase 0) |
| I | Secretos en eventos de auditoría | Nunca secretos, ni parciales; `metadata` con lista blanca de campos | Planeada (fase 0) |
| D | Ráfaga de negaciones o de eventos satura la tabla o el lock | Rate limiting; agrupación pendiente de decisión ([ADR 0022](adr/0022-audit-of-denials-in-independent-transaction.md), aceptada sin resolver la agrupación) | Pendiente de decisión |
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
| S | Correo falso que imita invitaciones o alertas | DKIM del dominio de envío; enlace de invitación de un solo uso, 72 horas, con hash en base de datos; el invitado define su contraseña, quien invita nunca la conoce | **Implementada en parte** (fase 1a): el correo sale por SMTP del dominio propio con STARTTLS obligatorio, certificado verificado y TLS 1.2 mínimo, y producción exige `smtp`; el enlace lleva el token en el fragmento y el vencimiento en UTC. **Fuera del sistema:** SPF, DKIM y DMARC se configuran en el DNS del dominio |
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
| Compromiso de la Raíz o pérdida de acceso | Códigos de emergencia custodiados por dos personas; transferencia con 72 horas de espera y aviso; alertas críticas ([runbook](runbooks/transfer-root.md)) | **Implementada en parte** (fase 1a): los códigos de emergencia (ver §4.1). **Planeada** (fase 1c): la transferencia de la Raíz con 72 horas de espera y las alertas críticas generales. Sin recuperación: olvidar la contraseña Y perder los factores |
| Fuga de la base de datos | Secretos cifrados con DEK protegida por KMS; el AAD impide reubicar texto cifrado | Planeada (fase 0); [runbook](runbooks/data-breach-response.md) |
| Falta de recuperación tras caída o desastre | PITR, snapshots entre regiones, RPO y RTO iniciales a validar, simulacro trimestral ([restaurar respaldo](runbooks/restore-backup.md)) | Planeada (gate de producción) |

## 6. Riesgos residuales y huecos conocidos

- **Servidor comprometido con acceso al KMS**: lee todos los secretos; solo se reduce con IAM mínimo, monitoreo y rotación. No existe una mitigación criptográfica adicional en el diseño actual.
- **Usuario legítimo malicioso**: el nivel USE protege contra exposición casual del secreto, pero un usuario decidido con acceso puede obtener lo que el cliente use (limitación reconocida del enfoque de extensión en el plan, fases 6 y 7).
- **Borrado de memoria**: Node no garantiza el borrado de memoria; el TTL corto de la caché de DEK es la mitigación.
- **Huecos de diseño en estado Propuesta**: [ADR 0024](adr/0024-audit-retention-vs-revoke-delete.md). El [ADR 0023](adr/0023-audit-advisory-lock-and-long-transactions.md) se aceptó el 2026-10-27. Los ADR 0021 y 0022 se aceptaron e implementaron en la fase 1a.
- **Pendientes de la fase 1a con efecto en la seguridad**: exigir passkeys a la Raíz y a los Administradores (hoy son opcionales) y la purga de los desafíos vencidos de las passkeys y de las claves de idempotencia vencidas; las opciones de ingreso con passkey devuelven los identificadores de las credenciales de quien ya verificó la contraseña; recuperación de la Raíz que olvida su contraseña y pierde sus factores (los códigos de emergencia no la sustituyen y no hay camino en el sistema); contadores de intentos y límite por IP en memoria de cada instancia (el sistema debe operar con una sola instancia hasta incorporar Redis); los demás avisos por correo (dispositivo nuevo, uso de un código de recuperación, cambios de factores); y la primera ejecución de la verificación automática (CI) en GitHub, despriorizada por el dueño.
- **Decisiones pendientes del equipo** que afectan a este modelo: proveedor de nube, política de retención validada con legal y la identidad de los custodios de los códigos de emergencia (ver "Decisiones pendientes del equipo" en el plan). Ya decididas (2026-10-27): las passkeys son opcionales y exigirlas queda como configuración futura; ningún Administrador puede restablecer la Raíz.
- **Producción aún no desplegable**: no existe el adaptador de KMS del proveedor (el local se niega a arrancar en producción) ni el worker; la elección de nube sigue abierta.
- **Pentest externo**: no realizado; es requisito del gate de producción y no se cargan credenciales reales hasta cerrar los hallazgos altos y críticos.

## 7. Revisión

| Cuándo | Qué se revisa |
| --- | --- |
| Al cerrar cada fase | Actualizar el estado (Planeada a Implementada) con evidencia en código o pruebas |
| Al abrir una fase con nuevos módulos (2 a 7) | Añadir las secciones de `federation`, `inbound-codes` y `broker` |
| Antes del pentest externo | Que el alcance del pentest cubra los puntos de este modelo |
| Tras un incidente | Registrar el escenario y la mitigación |
| Al aceptar un ADR en estado Propuesta | Actualizar la fila "Pendiente de decisión" correspondiente |
