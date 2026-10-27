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
| B1 Acceso efectivo y cuentas: catálogo de plataformas (lectura), crear, editar y archivar cuentas, listado filtrado por acceso efectivo, pantalla de cuentas | S4 (motor), S5, S6, S8 (listado) | pendiente | pendiente |
| B2 Credenciales: crear, cambiar contraseña con versiones y huella, historial sin contenido, copiar usuario; revelar contraseña con reautenticación, motivo, límite por hora y `no-store`; pantalla de detalle con ocultado a los 30 s | S1, S2, S3, S5, S7 | pendiente | pendiente |
| B3 Compartición y grupos: compartir y revocar por persona y por grupo, caducidad, no compartir más de lo propio, tarea de rotación al revocar tras una revelación, pantalla de compartir | S4 | pendiente | pendiente |
| B4 2FA en servidor: `RegisterTotpSecret` (validación, confirmación, pendiente 24 h), código bajo demanda, exportar, re-registrar y retirar; registro por clave manual y por imagen; pantallas | S9, S10, S12, S13 | pendiente | pendiente |
| B5 Registro 2FA por captura de pestaña, importación de Google Authenticator y handoff con celular (SSE) | S9, S11 | pendiente | pendiente (requiere decisión sobre la biblioteca para leer QR) |
| B6 Búsqueda avanzada, índice ciego por usuario y vistas guardadas | S8 | pendiente | pendiente |
| B7 Importación CSV | S14 | pendiente | pendiente |

## Decisiones abiertas

- Biblioteca para decodificar códigos QR en el navegador (B4 y B5): no hay ninguna aprobada. Propuesta: una biblioteca pequeña, mantenida y sin dependencias, con versión exacta y la espera de 7 días; la decisión es del equipo.
- Valor por defecto del límite de revelaciones por usuario y hora (el plan dice 30) y qué alerta se emite al superarlo (auditoría crítica; el canal de aviso depende del correo real, pendiente A8).
- Motivo escrito en revelar: longitud mínima y si es texto libre o lista cerrada (el plan solo dice "motivo").

## Log

- L1 (2026-10-27): Tarea creada a partir de la sección "Bóveda" y "2FA/TOTP" del plan y de la hoja de ruta (`docs/handoff.md`). Las tablas de la bóveda existen desde la fase 0; el motor de decisión, el catálogo de permisos con techos y el cifrado de sobre ya están implementados y probados (fases 0 y 1a).
