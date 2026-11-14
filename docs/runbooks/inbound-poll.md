# Runbook: Programar el sondeo de correo entrante (IMAP)

> **Borrador, pendiente de ensayo en un entorno de pruebas.** El comando existe y sus piezas están probadas por separado ([ADR 0045](../adr/0045-inbound-codes-mail-and-sms.md)); no se ha probado contra un servidor IMAP real ni la programación en el anfitrión. La programación es una propuesta que Ops debe ratificar.

## Objetivo

Que `inbound-poll` revise cada minuto los buzones configurados, extraiga los códigos de acceso de los correos que cumplan una plantilla y los guarde cifrados para los usuarios con permiso de lectura. También borra del buzón real los correos que una persona autorizada pidió borrar.

Las fuentes y sus conexiones IMAP (servidor, puerto, modo TLS, usuario y contraseña) se configuran desde la plataforma, en `/inbound/sources`; este proceso solo las lee. Una fuente sin conexión o sin contraseña guardada no se sondea.

## Qué hace una pasada

1. Lista las fuentes que tocan: activas, con contraseña guardada, sin retroceso vigente y sin otra pasada en curso.
2. Sondea cada una en serie, dentro de un presupuesto de tiempo y con un tope de fuentes. Lo que no alcanza queda para la pasada siguiente.
3. Por cada fuente: se conecta con TLS verificado, examina la bandeja de entrada sin modificarla, baja solo los mensajes nuevos dentro de la ventana de 15 minutos y los analiza en un proceso hijo aislado.
4. Un mensaje se acepta solo si la cabecera `Authentication-Results` del **servidor propio** declara una firma DKIM válida y alineada, y si coincide con una plantilla. Lo demás va a cuarentena con un motivo, sin guardar contenido.

Un fallo de una fuente (buzón caído, contraseña mala) no detiene a las demás: queda anotado con retroceso exponencial (tope de 1 hora).

## Borrado de correo a petición

Al terminar el sondeo, el mismo proceso ejecuta los borrados que una persona pidió desde la plataforma. La API solo registra la petición (ya autorizada, con reautenticación y auditada); el worker la ejecuta porque es el único que descifra la contraseña del buzón. El sondeo sigue en solo lectura: el borrado abre una sesión de escritura aparte.

1. Lista las fuentes de correo activas con peticiones pendientes (una sola petición pendiente por recibo).
2. Por fuente, abre el buzón con escritura y borra por UID, un mensaje por vez, hasta 20 por fuente y pasada. Lo que no alcanza queda para la pasada siguiente.
3. Antes de borrar compara el `UIDVALIDITY` guardado con el del buzón. Si cambió, no borra nada (`POSITION_CHANGED`).
4. Cada petición queda cerrada con un código acotado; nunca se guarda texto del servidor.

Requisitos de la cuenta y del servidor (**sin comprobar contra un servidor real**):

- La cuenta IMAP del buzón necesita derecho de borrar mensajes (marcar y expulsar) además del de leer.
- El servidor debe ofrecer la extensión `UIDPLUS`. Sin ella, expulsar borraría todos los mensajes marcados como eliminados del buzón, no solo el pedido; por eso Compass falla cerrado antes de marcar nada (`UNSUPPORTED`). Verifícalo con el servidor de correo de la organización antes de anunciar la función; está pendiente.

Cómo leer el resultado de una petición (código de resultado):

| Código | Qué significa | Qué hacer |
| --- | --- | --- |
| `DELETED` | El servidor confirmó el borrado | Nada |
| `NOT_FOUND` | El mensaje ya no estaba (alguien lo borró, o dos pasadas coincidieron) | Nada: el objetivo ya se cumplió |
| `POSITION_CHANGED` | El buzón se reindexó (`UIDVALIDITY` distinto) y el UID guardado ya no apunta a ese mensaje | No se borró nada. Borra el mensaje a mano en el buzón si hace falta |
| `UNSUPPORTED` | El servidor no ofrece `UIDPLUS` | No se borró nada. Habilítalo o usa un servidor que lo ofrezca |
| `CONNECTION` | Fallo de conexión, de autenticación, del KMS o de la contraseña | No se reintenta solo: la persona puede volver a pedirlo. Revisa la fuente como en «Si algo falla» |
| `CONNECTION_MISSING` | La fuente no tiene conexión o contraseña guardada | Configura la conexión de la fuente y pide el borrado de nuevo |
| `UNEXPECTED` | Defecto de la aplicación | La pasada sale con código `1`; lo demás queda pendiente |

## Precondiciones

- API compilada: `pnpm --filter @iam/api build` (genera `dist/main.inbound-poll.js`).
- Migraciones al día (0029 en adelante; 0037 y 0038 para el borrado de correo) y el rol `iam_inbound_worker` con inicio de sesión habilitado y contraseña propia (la custodia Ops).
- Variables del proceso (archivo de entorno **propio**, distinto del de la API). `NODE_ENV` es obligatoria y sin valor por defecto: sin ella el proceso no arranca.

| Variable                                | Para qué                                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                              | `production` en producción. Con otro valor se acepta la KEK local, solo para desarrollo.                    |
| `DATABASE_URL_INBOUND_WORKER`           | Conexión con el rol `iam_inbound_worker`. Nunca la de la aplicación ni la de migraciones.                  |
| `KMS_ADAPTER`, `AWS_KMS_KEY_ID`, `AWS_REGION` | El mismo KMS que la API. En producción solo `aws`. La política del KMS del worker debe permitir solo `Decrypt`. |
| `LOCAL_KMS_KEY_FILE`                    | Opcional, `.local-kms/kek.key` por defecto. Ruta de la KEK local; solo se usa con `KMS_ADAPTER=local`, que en producción se rechaza. |
| `INBOUND_POLL_ALLOWED_PRIVATE_NETWORKS` | Opcional. IP o CIDR privados (coma) donde puede vivir el servidor de correo. Vacío: solo direcciones públicas. |
| `INBOUND_POLL_MAX_SOURCES_PER_RUN`      | Opcional, 50 por defecto.                                                                                   |
| `INBOUND_POLL_FAILURE_EXIT_THRESHOLD`   | Opcional, 5 por defecto (de 1 a 1000). Fallos seguidos de una misma fuente a partir de los cuales la pasada sale con código `1`. |
| `INBOUND_POLL_RUN_BUDGET_SECONDS`       | Opcional, 50 por defecto. Solo impide **empezar** otra fuente pasado ese tiempo; una fuente en curso puede tardar hasta 60 s más (su propio presupuesto) y los tiempos de red. |

- El servidor de correo propio debe **anteponer** su `Authentication-Results` (con el `authserv-id` que se registra en la conexión) y **eliminar** cualquier cabecera `Authentication-Results` que traiga el mensaje entrante. Sin esa limpieza, el remitente podría fabricar un veredicto. Verifícalo con un mensaje de prueba antes de activar una fuente.
- Cortafuegos de salida del contenedor: solo los puertos IMAP necesarios (143 y 993) hacia los servidores de correo. El proceso hijo que analiza el MIME no tiene red por diseño de la aplicación, pero Node no lo impone: la contención de red la da el despliegue.
- Una sola programación activa. Una pasada puede durar más que el minuto del cron (ver el presupuesto arriba) y entonces se encima con la siguiente: es seguro (el arrendamiento por fuente las excluye) pero duplica el listado y la carga de descifrado; si ocurre seguido, sube el periodo del cron o baja `INBOUND_POLL_MAX_SOURCES_PER_RUN`.

## Programarlo _(propuesta)_

Cada minuto, con el entorno propio del worker:

```text
* * * * * cd <ruta de la API> && node dist/main.inbound-poll.js >> <ruta de registros>/inbound-poll.log 2>&1
```

## Salida y alertas

- Una línea JSON por mensaje (`event: inbound.message`): id de fuente, huella, resultado, motivo de cuarentena, veredictos `spf`, `dkim` y `dmarc`, y de la firma DKIM que sostuvo el mensaje: `signingDomain` (`d=`), `selector` (`s=`), `aligned`, `bodyLengthLimit` (`l=`) y `signedHeaders` (conteo de `h=`). Todo es `null` si no hubo firma validada; el dominio y el selector solo se escriben si tienen forma de nombre DNS. **Nunca** asunto, cuerpo, direcciones, código ni enlace.
- Una línea de resumen por pasada: fuentes listadas, intentadas, completas, con arrendamiento ajeno, fallidas, diferidas, códigos aceptados y en cuarentena.
- Una línea de resumen de borrados después de la anterior: `Borrados de correo: fuentes N; borrados N; no borrados N`. No lleva identificadores ni contenido del correo; el detalle de cada petición vive en su fila (estado y código de resultado).
- Por stderr, un conteo de fallos por código acotado (`AUTH`, `TLS`, `TIMEOUT`, `NETWORK`, `HOST_REJECTED`, `MAILBOX_UNAVAILABLE`...). Nunca texto del servidor ni el host.

Código de salida:

- `0`: la pasada terminó. Algunas fuentes pueden haber fallado; su retroceso ya quedó anotado.
- `1`: un borrado de correo cerró con `UNEXPECTED`, configuración inválida, la base no respondió, o alguna fuente falló por un motivo del sistema y no del buzón: `KMS_UNAVAILABLE` (el KMS no respondió o no hay llave activa) o `UNEXPECTED` (un defecto), o porque una fuente acumula `INBOUND_POLL_FAILURE_EXIT_THRESHOLD` fallos seguidos (el buzón sigue caído aunque su retroceso crezca; revisa la fuente en la pantalla de fuentes y su código de fallo por stderr). Alerta al equipo de guardia si pasa en dos ejecuciones seguidas.
- Ausencia de salida durante más de 5 minutos: el cron dejó de correr. Alerta por ausencia.

## Si algo falla

| Síntoma                                              | Causa probable y acción                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `Invalid configuration: DATABASE_URL_INBOUND_WORKER` | Falta la variable propia del worker. No sirve `DATABASE_URL`.                                                |
| Fallos `HOST_REJECTED`                               | El servidor resolvió a una dirección privada o reservada. Si es legítimo, agrégalo a `INBOUND_POLL_ALLOWED_PRIVATE_NETWORKS` con el bloque más estrecho posible. |
| Fallos `AUTH` repetidos                              | La contraseña del buzón cambió. Actualiza la conexión desde la plataforma; el retroceso se reinicia al primer éxito. |
| Muchos mensajes en cuarentena `AUTH_RESULTS_AMBIGUOUS` | El servidor propio no antepone una sola `Authentication-Results` con el `authserv-id` esperado. Revisa su configuración. |
| Salida `1` con `UNEXPECTED`                          | Defecto de la aplicación: conserva el registro y abre un incidente. No reintentes a ciegas.                  |
| Peticiones de borrado cerradas con `UNSUPPORTED`     | El servidor no ofrece `UIDPLUS`. Ver «Borrado de correo a petición».                                         |

## Riesgo residual (declarado)

El proceso reúne el acceso a la base, al KMS y las contraseñas descifradas, y su rol puede fijar la organización de cada fuente. Un worker comprometido podría leer las contraseñas de todos los buzones (ADR 0045, "Contención si el worker se compromete"). Se reduce con el rol de mínimo privilegio, la política `Decrypt`-solo del KMS, el análisis MIME aislado, el cortafuegos de salida y alertas por volumen de `Decrypt`. Entra en el alcance de la prueba de intrusión.
