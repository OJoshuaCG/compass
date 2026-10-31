# Specs e2e de importaciones y de reautenticación con passkey (T16, T11)

Tarea tomada por la IA con permiso delegado del dueño. Los specs NO se ejecutaron: los corre otra persona con `pnpm build && pnpm e2e`. Solo se verificaron formato, tipos y lint. No se tocó código de producto ni se agregaron dependencias.

## Especificación (textual del encargo)

- T16: specs de navegador para (a) importación de credenciales por CSV (vista previa y confirmación) y (b) importación desde Google Authenticator (N3b). Archivos subidos con `setInputFiles` y buffers generados en el test, datos obviamente falsos. Cubrir camino feliz, archivo inválido con mensaje y que el secreto no queda visible en el DOM al terminar.
- T11: spec de reautenticación con passkey (ADR 0033) si ya existe el autenticador virtual (CDP WebAuthn); si requiere infraestructura sustancial o dependencias, omitirlo y documentarlo.
- Si algo no es observable en la UI, no inventarlo: omitirlo y anotarlo.

## Decisiones

- Los textos son en-US: es lo que usa el e2e existente (`locale: 'en-US'` en `playwright.config.ts` y en los specs vecinos), aunque el encargo mencionaba es-MX.
- `vault.spec.ts` ya cubría el camino feliz del CSV (vista previa, confirmación y todo-duplicado). El spec nuevo no lo repite igual: añade el camino feliz con comprobación de secretos y los casos inválidos.
- Archivos nuevos separados (`vault-import.spec.ts`, `reauth-passkey.spec.ts`): ordenan alfabéticamente después de `identity.spec.ts`, que deja registrada la clave TOTP de la Raíz que `signInAsRoot` recuerda. Con `workers: 1` el orden es el del nombre de archivo.
- Imagen del QR: el repositorio no tenía forma de generar un PNG con un QR en e2e. `tests/support/qr-image.ts` usa `qrcode` (ya dependencia de `@iam/web`, resuelta desde su paquete con `createRequire`, sin declararla en e2e) y codifica el PNG con `node:zlib`. El enlace de migración se arma igual que `migration-test-fixture.ts` de la web.
- Autenticador virtual: no hay helper compartido; existe inline en `identity.spec.ts` (10 líneas con CDP). Se repite el mismo patrón en `reauth-passkey.spec.ts` sin infraestructura nueva y sin editar `identity.spec.ts`. Por eso T11 SÍ se escribió.

## Casos escritos

`e2e/tests/vault-import.spec.ts` (serial, una sesión de la Raíz):

1. CSV con cabecera incorrecta: mensaje de error, sin tabla ni botón Import.
2. Archivo sin extensión `.csv`: mensaje del navegador, sin vista previa, sin contraseña en pantalla.
3. CSV con filas inválidas (plataforma inexistente, contraseña vacía): resumen, errores por fila, aviso de bloqueo y botón Import deshabilitado.
4. CSV válido: vista previa, confirmación, conteos del resultado; tras terminar ni contraseñas ni usuario aparecen en HTML, valores de campos, almacenamiento ni URL; las cuentas salen en la tabla.
5. Importación de Google Authenticator inválida: exportación dañada, QR que no es TOTP, solo HOTP (nada importable, con aviso de omitidas) y archivo que no es imagen; en todos el botón Register queda deshabilitado y no se filtra ninguna clave.
6. Importación de Google Authenticator con varias cuentas (2 TOTP y 1 HOTP): selector con foco en el encabezado, aviso de HOTP omitida, elegir la cuenta B, registrar, confirmar con el código calculado de la clave de B (prueba que se importó la elegida) y estado Verified; ni las claves (texto o Base32) ni el enlace quedan en el navegador.

`e2e/tests/reauth-passkey.spec.ts`: la Raíz agrega una primera llave (reautenticando con código), cierra sesión, entra con passkey, agrega una segunda llave y, en el diálogo "Confirm your identity", usa "Use a passkey" en lugar del código.

## Omitido

- Un rechazo de la reautenticación con passkey (cancelar la solicitud del navegador, llave desconocida): el autenticador virtual no ofrece un modo estable de simular la cancelación; la cubren las pruebas de componente (`reauth.test.tsx`).
- Elegir una exportación de Google Authenticator con una sola cuenta TOTP (uso directo sin selector): no se escribió para no alargar el spec, la cubre `totp-qr.test.tsx`.
- Paginación de la vista previa del CSV y límites de tamaño (1 MB, 500 filas): costosos de generar en navegador y ya cubiertos en pruebas de componente y de API.

## Tareas

| ID | Tarea | Estado |
| --- | --- | --- |
| T16-1 | Soporte `qr-image.ts` (PNG del QR, enlace de migración, Base32) | Hecha |
| T16-2 | Spec CSV (cabecera, extensión, filas inválidas, camino feliz) | Escrito, sin ejecutar |
| T16-3 | Spec Google Authenticator (inválidos y varias cuentas) | Escrito, sin ejecutar |
| T11-1 | Spec de reautenticación con passkey | Escrito, sin ejecutar |
| T16-4 | Ejecutar `pnpm build && pnpm e2e` y ajustar selectores si algo no coincide | Pendiente (otra persona) |

## Bitácora

- 2026-10-30: escritos los specs. Verificado: `format:check`, `typecheck` y `lint` de `@iam/e2e`. NO ejecutado Playwright. Supuestos sin comprobar en navegador: textos exactos de los avisos, que `qrcode` se resuelva desde `@iam/web`, que el servidor acepte las claves falsas de 20 bytes y que iniciar sesión con passkey no cuente como reautenticación reciente (según `pg-session-repository` solo los endpoints de reauth fijan `reauth_at`).
