# Fase 1b · Bóveda y segundo factor

Objetivo: guardar cuentas y credenciales de plataformas externas, compartirlas por persona y por grupo, revelar contraseñas con auditoría y generar códigos del segundo factor en el servidor. Rama: `main`. Runner: Vitest (`pnpm test`, `pnpm e2e`). Método: Ralph (hasta 5 iteraciones por porción) + Judgment Day (dos jueces ciegos, máximo dos rondas) en lo sensible, con mutación manual. Las tablas ya existen (migraciones 0005, 0006 y 0007); esta fase construye los casos de uso, la API y las pantallas.

**Todavía no debe cargarse ninguna credencial real** hasta cerrar la fase 1 y pasar una prueba de penetración externa (ver `README.md`).

## Specs

Textuales del plan (secciones "Bóveda" y "2FA/TOTP"):

- S1. "Los secretos solo se descifran en tres momentos auditados: revelar, generar un código 2FA y (en el futuro) inyectar en una sesión."
- S2. "El secreto nunca viene en listados ni en el detalle; solo en una respuesta dedicada a la acción de revelar, con `Cache-Control: no-store`." Se muestra oculto y se vuelve a ocultar a los 30 segundos; el portapapeles se limpia a los 30 segundos (mejor esfuerzo).
- S3. Revelar contraseña: `credential.reveal_password` + VIEW, "Reautenticación, motivo, auditoría". "Límite configurable de revelaciones por usuario y hora (por defecto 30); superarlo bloquea la acción y alerta."
- S4. Niveles de compartición USE ⊂ VIEW ⊂ EDIT ⊂ MANAGE. "El nivel efectivo es el máximo entre lo directo y lo heredado por grupos." "Nadie comparte un nivel superior al suyo sobre ese recurso." Una compartición puede tener `expires_at`; "el motor también las ignora al evaluar". "Revocar es inmediato; si el usuario reveló la contraseña antes, se genera una tarea de rotación."
- S5. Casos de uso: crear cuenta (`account.create`, el creador recibe MANAGE, grupo propietario opcional); editar (`account.update` + EDIT); archivar (`account.archive` + MANAGE, revoca comparticiones, los secretos se conservan cifrados); crear credencial (`credential.create` + EDIT); cambiar contraseña (`credential.update` + EDIT, nueva versión, huella de reutilización, fecha de rotación); copiar usuario (USE, auditoría ligera); historial de versiones (EDIT, sin revelar contenido).
- S6. Catálogo de plataformas global sembrado más plataformas propias de la organización; plataforma "Personalizada"; restricciones de contraseña por plataforma; `login_strategy` y `mail_rules` vacíos en la fase 1.
- S7. Generador de contraseñas en la interfaz (`crypto.getRandomValues`, longitud por defecto 24, juegos de caracteres, frase opcional); el servidor solo recibe el resultado al guardar.
- S8. Búsqueda por nombre visible, handle, plataforma, etiquetas y grupo, "siempre filtrada por acceso efectivo en SQL"; búsqueda exacta del usuario de la plataforma por índice ciego; vistas guardadas ("Mis cuentas", "Sin 2FA", "Por rotar").
- S9. 2FA: "Los cinco métodos de registro están disponibles siempre y el usuario elige; todos terminan en el mismo caso de uso, `RegisterTotpSecret`." El QR nunca se sube como imagen; al servidor solo llega la URI ya extraída. Validación: tipo `totp` (HOTP se rechaza), SHA1/SHA256/SHA512, 6 u 8 dígitos, periodo 30 o 60, secreto Base32 de al menos 128 bits.
- S10. "Confirmación obligatoria": el sistema muestra el código actual, la persona lo introduce en la plataforma y confirma en el sistema; solo entonces el secreto pasa a `verified`; un `pending` sin verificar en 24 horas genera un aviso.
- S11. Handoff con celular: token de 256 bits (se guarda su hash), un solo uso, 5 minutos, ligado a usuario y credencial; el escritorio confirma antes de guardar.
- S12. `POST /credentials/:id/totp-code` → `{ code, expiresIn, nextCode? }`; requiere USE y `credential.use_totp`; límite por usuario y credencial; auditoría ligera de cada código.
- S13. Exportar el secreto 2FA: MANAGE, `credential.export_totp`, reautenticación y motivo, evento crítico, marca "secreto expuesto". Re-registrar crea versión nueva (la anterior se conserva 30 días); retirar el 2FA exige EDIT y queda marcado.
- S14. Importación CSV con previsualización y validación, al final; el archivo se procesa en memoria y nunca se guarda.

## Tasks

Cada porción es vertical (casos de uso + API + pantalla + pruebas + documentación) y termina con sus pruebas, mutación manual y commit convencional. Orden por dependencia.

| ID | Specs | Ruta | Estado |
| --- | --- | --- | --- |
| B1 Acceso efectivo y cuentas: catálogo de plataformas (lectura), crear, editar y archivar cuentas, listado filtrado por acceso efectivo, pantalla de cuentas | S4 (motor), S5, S6, S8 (listado) | directa | backend y pantalla hechos (2026-10-28) |
| B2 Credenciales: crear, cambiar contraseña con versiones y huella, historial sin contenido, copiar usuario; revelar contraseña con reautenticación, motivo, límite por hora y `no-store`; pantalla de detalle con ocultado a los 30 s | S1, S2, S3, S5, S7 | B2a backend hecho (2026-10-28); pantalla (B2b) pendiente | pendiente |
| B3 Compartición y grupos: compartir y revocar por persona y por grupo, caducidad, no compartir más de lo propio, tarea de rotación al revocar tras una revelación, pantalla de compartir | S4 | pendiente | pendiente |
| B4 2FA en servidor: `RegisterTotpSecret` (validación, confirmación, pendiente 24 h), código bajo demanda, exportar, re-registrar y retirar; registro por clave manual y por imagen; pantallas | S9, S10, S12, S13 | pendiente | pendiente |
| B5 Registro 2FA por captura de pestaña, importación de Google Authenticator y handoff con celular (SSE) | S9, S11 | pendiente | pendiente (requiere decisión sobre la biblioteca para leer QR) |
| B6 Búsqueda avanzada, índice ciego por usuario y vistas guardadas | S8 | pendiente | pendiente |
| B7 Importación CSV | S14 | pendiente | pendiente |

## Prerrequisitos

- [ADR 0023](../../docs/adr/0023-audit-advisory-lock-and-long-transactions.md) (bloqueo de auditoría): toda acción de la bóveda escribe auditoría en su transacción, y revelar una contraseña toma además el bloqueo por usuario del [ADR 0031](../../docs/adr/0031-reveal-rate-limit-per-user.md) antes que el de auditoría. Ninguna porción de esta fase empieza sin el `lock_timeout` de 5 s y la falla cerrada ya implementados (G6) y sin medir la latencia p95 de la auditoría que el ADR deja pendiente.
- [ADR 0036](../../docs/adr/0036-effective-access-computed-on-the-fly.md) (acceso efectivo al vuelo): el umbral de la sección siguiente decide si se materializa.
- Decisiones B1, B2 y B5 de `TODO.md` (cerradas): lock de auditoría, límite de 30 revelaciones por hora y Operador sin `credential.reveal_password`.

## Criterios de aceptación medibles

Las cifras marcadas como **propuesta** son un punto de partida para que el equipo las confirme o las cambie antes de empezar la porción; una porción no se da por terminada sin cumplir las suyas. Las demás salen de los specs o de los ADR citados.

**Acceso efectivo y cuentas (I2, ADR 0036).**

- Con el volumen de prueba de **propuesta** (1 organización, 5 000 cuentas, 20 000 comparticiones, 200 grupos, una persona con 500 cuentas visibles), el listado paginado de 50 cuentas filtrado por acceso efectivo tarda **p95 ≤ 150 ms** medido en la base, sin contar la red.
- Si p95 supera **300 ms** con ese volumen, se abre la decisión de materializar la vista (ADR 0036) antes de seguir con K2 y O1; entre 150 y 300 ms se anota y se vigila.
- El listado nunca devuelve una cuenta sin acceso efectivo, una compartición revocada o vencida, ni una cuenta de un grupo archivado; una prueba por cada caso lo comprueba con el reloj controlado.
- Quien tiene `vault.inventory.read` (Raíz y Administradores) ve en el inventario los metadatos de **todas** las cuentas de su organización, aunque no tenga compartición, y nunca un secreto ni su existencia como credencial revelable. No gana por ello USE, VIEW ni ninguna otra acción sobre la cuenta (ADR 0010). Una prueba comprueba que desde el inventario revelar, copiar usuario y pedir un código responden `403`.
- Archivar una cuenta (`account.archive`) revoca todas sus comparticiones en la misma transacción, la saca del listado y del inventario por defecto, conserva sus secretos cifrados y deja un evento de auditoría; una prueba comprueba que ninguna persona la revela ni genera códigos después, y que la fila y sus versiones siguen en la base.

**Credenciales y compartición (K1, K2, M2).**

- Cambiar la contraseña crea una versión nueva sin borrar la anterior; el historial devuelve versiones, fechas y autor, y **ningún campo con contenido** (una prueba recorre la respuesta buscando el texto de la contraseña).
- Compartir un nivel superior al propio responde `403 AUTHZ.ROLE_ESCALATION` o su equivalente de compartición, con la negación auditada.
- Revocar una compartición tiene efecto en la **siguiente petición** de la persona afectada (sin esperar caché ni expiración de sesión); si esa persona reveló la contraseña antes, queda registrada una tarea de rotación consultable.
- Restaurar una versión (M2) crea una versión nueva con el contenido de la elegida; no reescribe el historial y exige EDIT.

**Revelar contraseña (M1, ADR 0031).**

- La respuesta lleva `Cache-Control: no-store`, el secreto no aparece en listados, detalle, registros ni en el cuerpo de ninguna respuesta de error.
- Exige reautenticación vigente (ventana de 5 min) y motivo; sin cualquiera de los dos responde la negación auditada y no se descifra nada.
- Límite de **30 revelaciones exitosas por usuario y hora**, contadas desde la auditoría (ADR 0031). La revelación 31 dentro de la misma hora móvil se niega con un código estable y la negación se audita.
- Desbloqueo: se rige por la ventana móvil, no por un reloj fijo. La persona vuelve a poder revelar en cuanto la revelación exitosa más antigua de la última hora cumple **60 min** (probado con reloj controlado: 30 revelaciones, la 31 negada, avanzar a 60 min + 1 s desde la primera, la siguiente pasa).
- Con **propuesta** de 20 revelaciones concurrentes de la misma persona cuando le quedan 5 de cupo, exactamente 5 tienen éxito y 15 se niegan (prueba de concurrencia; sin ella el lock por usuario no está probado).
- Superar el tope envía el aviso a la Raíz; el canal real depende del correo (A8), así que mientras tanto el criterio es que exista el evento de auditoría crítico y el aviso pendiente en la bandeja de salida.
- La interfaz oculta el secreto a los **30 s** y limpia el portapapeles a los 30 s (mejor esfuerzo): prueba de componente con temporizador simulado.

**Segundo factor (N1 a N3).**

- Validación de la URI: se rechazan HOTP, algoritmos distintos de SHA1/SHA256/SHA512, dígitos distintos de 6 u 8, periodo distinto de 30 o 60 y secretos de menos de 128 bits; una prueba por cada caso.
- Un secreto `pending` no pasa a `verified` sin el código actual confirmado; si lleva **24 h** sin confirmar se genera el aviso (prueba con reloj controlado).
- El código bajo demanda exige USE y `credential.use_totp`, responde con `expiresIn` y deja auditoría ligera en cada solicitud; el límite por usuario y credencial se fija en la porción (**propuesta**: 10 por minuto).
- Exportar el secreto exige MANAGE, `credential.export_totp`, reautenticación y motivo, marca el secreto como expuesto y escribe un evento crítico.
- El token de entrega por celular (N3) es de 256 bits, se guarda solo su hash, sirve **una vez** y caduca a los **5 min**; un segundo uso y un uso tardío responden error y se prueban.

**Búsqueda e importación (O1, O2).**

- Toda búsqueda se filtra por acceso efectivo **en SQL**, nunca después; una prueba comprueba que una persona sin acceso no obtiene la cuenta ni por nombre, etiqueta, plataforma, grupo ni usuario exacto.
- La búsqueda exacta por usuario de la plataforma usa el índice ciego: el plan de ejecución de la consulta usa el índice y no recorre la tabla (prueba sobre el volumen de **propuesta**).
- La importación CSV procesa el archivo en memoria, valida antes de guardar y no deja el archivo ni su contenido en disco ni en los registros; con una fila inválida, la previsualización la señala y no se guarda nada hasta confirmar.

**Para todas las porciones.** Las pruebas de autorización, aislamiento y criptografía las revisa una persona antes de cerrar la porción; cada porción deja la mutación manual hecha y registrada en su bitácora.

## Decisiones abiertas

- Biblioteca para decodificar códigos QR en el navegador (B4 y B5): no hay ninguna aprobada. Propuesta: una biblioteca pequeña, mantenida y sin dependencias, con versión exacta y la espera de 7 días; la decisión es del equipo.
- Valor por defecto del límite de revelaciones por usuario y hora (el plan dice 30) y qué alerta se emite al superarlo (auditoría crítica; el canal de aviso depende del correo real, pendiente A8).
- Motivo escrito en revelar: longitud mínima y si es texto libre o lista cerrada (el plan solo dice "motivo").

## Log

- B1a (2026-10-28): Backend de cuentas hecho: catálogo de plataformas, listado por acceso efectivo, inventario (`vault.inventory.read`), consultar, crear (con MANAGE directo para quien crea), editar (EDIT) y archivar (MANAGE, revoca las comparticiones en la misma transacción). Dos llaves: permiso del catálogo y nivel efectivo sobre la cuenta; sin acceso responde `NOT_FOUND`, con nivel insuficiente `AUTHZ.SHARE` auditado con el id de la cuenta. Editar y archivar bloquean la fila antes de leer el nivel (los dos jueces ciegos señalaron la carrera); mutación comprobada (sin el chequeo de nivel fallan dos pruebas). Medición p95 del listado con 5 000 cuentas, ~20 000 comparticiones y 200 grupos (490 cuentas visibles): ≈ 16 ms en la primera página y en una página profunda, muy por debajo de 150 ms; no se materializa (ADR 0036). Migración 0016 (índice del orden del listado). Pendiente de esta porción: revisión humana de las pruebas de autorización y del cambio aditivo en el autorizador (`targetAccountId`), y que la tarea de rotación al revocar llega con B3.

- B1b (2026-10-28): Pantalla web de cuentas (`/accounts`): listado con el nivel propio en texto, pestaña de inventario solo con `vault.inventory.read`, y diálogos de crear, editar (nivel EDIT o superior) y archivar (MANAGE), con catálogos es-MX y en-US, pruebas de componente y axe. `GET /accounts` solo exige ser miembro activo, así que la ruta y el enlace de navegación los ve cualquier miembro; lo que depende de permisos son las acciones y el inventario. Sin selector de grupo responsable (no hay listado de grupos en el front todavía) ni cambio de plataforma al editar. Pendiente: pruebas e2e de la pantalla.

- B2a (2026-10-28): Backend de credenciales hecho: crear (EDIT), cambiar contraseña con versiones y huella (EDIT), historial sin contenido (EDIT), copiar usuario (USE, auditado) y revelar contraseña (VIEW). Revelar exige reautenticación de 5 min (motor), motivo de texto libre de **6 a 500 caracteres** (decisión del 2026-10-28, reemplaza la lista cerrada de B3; un motivo inválido deja una negación auditada y no descifra nada), y no más de 30 revelaciones exitosas por persona en una hora móvil (ADR 0031, conteo desde la auditoría con bloqueo por persona antes del de auditoría; el evento crítico y el aviso en la bandeja de salida se dejan una vez por ventana). Las respuestas con secretos llevan `Cache-Control: no-store` y esas rutas no usan `@Idempotent()`. Migración 0017 (índice de conteo por persona y acción). Revisión de los dos jueces ciegos: se corrigieron las dos cosas que ambos confirmaron (un fallo de criptografía devolvía `err` y la unidad de trabajo confirmaba un estado a medias; ahora lanza y revierte; y la lectura posterior a la auditoría en cambiar contraseña). Mutación comprobada (sin el límite fallan las dos pruebas de límite). Discrepancia a decidir: el criterio de "403 desde el inventario" choca con la regla de B1 (sin acceso, `NOT_FOUND`); se respondió 404 con la negación auditada. Seguimiento (señalado por un solo juez, sin confirmar): historial y copiar usuario no exigen permiso del catálogo, solo nivel; las negaciones por falta de acceso en crear, cambiar y copiar no se auditan (revelar sí); cambiar contraseña no bloquea la cuenta; el límite no es configurable por organización; el motivo cuenta unidades UTF-16. Pendiente: revisión humana de las pruebas de autorización y del cambio aditivo en la auditoría (lista de acciones, contador, índice), prueba de reversión ante fallo de criptografía, y la pantalla (B2b).

- I1 (2026-10-28): Añadidos prerrequisitos (ADR 0023, 0031, 0036) y criterios de aceptación medibles por porción. Los umbrales numéricos son propuestas pendientes de confirmar por el equipo; el umbral de latencia p95 del acceso efectivo decide si se materializa (ADR 0036).

- L1 (2026-10-27): Tarea creada a partir de la sección "Bóveda" y "2FA/TOTP" del plan y de la hoja de ruta (`docs/handoff.md`). Las tablas de la bóveda existen desde la fase 0; el motor de decisión, el catálogo de permisos con techos y el cifrado de sobre ya están implementados y probados (fases 0 y 1a).
