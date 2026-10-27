# Fase 1a · Identidad

Objetivo: invitación → contraseña → segundo factor obligatorio → sesión → reautenticación, con la matriz de jerarquía y permisos completa. Rama: `main`. Runner: Vitest (`pnpm test`). Método: Ralph (hasta 5 iteraciones) + Judgment Day (dos jueces ciegos, máximo dos rondas).

## Specs

- S1. Alta por invitación: matriz de creación, no escalamiento, enlace de un solo uso de 72 h que quien invita no ve.
- S2. Contraseña mín. 12 caracteres sin reglas de composición, rechazo de comunes y de datos personales; Argon2id.
- S3. Segundo factor TOTP obligatorio antes de la primera sesión completa; 10 códigos de recuperación de un solo uso; un código TOTP no se reutiliza.
- S4. Sesiones con cookie protegida, inactividad 30 min, límite absoluto 12 h, cierre que revoca en el servidor, protección CSRF.
- S5. Reautenticación (5 min) exigida por el motor de autorización; toda negación se audita aunque la acción se revierta.
- S6. Matriz de jerarquía (quién crea y gestiona a quién) y catálogo de 27 permisos con techos, probados como datos.
- S7. Bloqueo temporal de intentos (no permanente) y mensajes/tiempos equivalentes ante usuario inexistente.
- S8. Directorio visible con orden, límite y paginación por cursor; pantallas de identidad en el frontend.

## Tasks

| ID | Specs | Ruta | Estado |
| --- | --- | --- | --- |
| T1 Contratos y dependencias (otplib, zxcvbn-ts, cookies, rate limiter, qrcode) | S1–S8 | inline | hecho |
| T2 Dominio de jerarquía y permisos con matrices | S6 | inline | hecho (316 casos) |
| T3 Módulos directory, access, identity, provisioning, notification | S1–S7 | inline | hecho |
| T4 Capa HTTP (guardas de sesión y CSRF, límites, controladores, composición) | S4, S7 | inline | hecho |
| T5 Pruebas de punta a punta contra PostgreSQL real | S1–S8 | inline | hecho (47 casos) |
| T6 Pantallas de identidad | S8 | delegado (frontend-developer) | hecho (130 pruebas web) |
| T7 Documentación de negocio y ADR | todas | delegado (documentation-expert) | en curso |
| T8 Revisión adversarial y correcciones | S1–S7 | delegado (jd-judge-a/b) | JUDGMENT APPROVED, ronda 2 |

Route declaration: T6 y T7 son unidades independientes de varios minutos con superficies disjuntas (frontend y docs), lanzadas junto con el backend (Writer trigger, motivo a: paralelismo). El backend (T1–T5) quedó inline por estar fuertemente acoplado.

## Log

- L1 (2026-10-27, usuario, verbatim): "Tienes permiso de hacer las pruebas necesarias, y hacer las correcciones pertinentes. Posteriormente apoyate con el agente git para hacer los conventonal commits. Valida que todo este documentado a nivel logica de negocio. No debes documentar codigo como tal, solo logica de negocio, nada de ocidog. Y por ultimo puedes continar con las siguientes fases. Tienes permiso de continuar con las siguientes fases y hacer todo lo necesario para comprobar que todo esta bien"
- L2: Hallazgo del e2e: el rol de la aplicación no tiene DELETE sobre credenciales (diseño de BD); los repositorios usan baja lógica (`revoked_at`, `used_at`).
- L3: Hallazgo de diseño: la caducidad por inactividad comparaba el reloj de la aplicación con `last_seen_at` del reloj de la BD; ahora la aplicación fija ambos (ADR 0025).
- L4: Jueces, ronda 1 (sin críticos, 5 coincidencias): invitación vencida bloqueaba reinvitar; roles de la invitación sin revalidar al aceptar; cursor manipulado → 500; bloqueo de intentos no atómico (ADR 0026); diferencia de tiempo en el login. Más: límite por IP decidido por texto de URL (ahora por metadatos de ruta). Mutantes manuales: 5/5 detectados tras reforzar una prueba.
- L5: Jueces, ronda 2 (2 coincidencias): NUL en cursor/búsqueda/nombre → 500; al aceptar no se revalidaba que el responsable siguiera pudiendo invitar. Corregidas; re-juicio sin hallazgos. Mutantes: 4/4 detectados tras añadir una prueba que aislara el permiso.
- L6: Pendiente (no es defecto, es alcance): passkeys; cambio de la contraseña inicial de la Raíz (el indicador existe pero no se aplica); códigos de emergencia de la Raíz; Redis para límites entre instancias; proveedor real de correo; idempotencia de POST de creación; roles personalizados desde la interfaz; ejecución del CI en GitHub.
- L7 (2026-10-27): Revisión del frontend de identidad (jueces ciegos A y B, 101 archivos): 6 hallazgos coincidentes corregidos por el agente de frontend (reautenticación cancelada en vuelo, expiración con diálogo abierto, `returnTo` con caracteres de control, clave de idempotencia reutilizada con otro cuerpo, pila de cursores obsoleta, portapapeles y anuncio al copiar). Mutantes: 4/4 detectados.
- L8: Hueco de arquitectura cerrado: la API ahora sirve la SPA en el mismo origen (antes solo existía en el plan), con fallback de rutas del cliente, `/api/` desconocido como Problem Details y caché por ruta relativa.
- L9: Primeras pruebas en navegador real (Playwright con el Chrome instalado, 8 casos): CSP sin violaciones, cookie `__Host-session` con las banderas del plan, alta del segundo factor con QR y códigos de recuperación, invitación de punta a punta, directorio, idioma. Descubrieron una violación de CSP que jsdom no veía (hoja de estilos fija que Radix inyecta al abrir un diálogo modal): se permite solo ese contenido por su hash SHA-256, no `unsafe-inline`; la prueba de navegador es la guardia ante actualizaciones.
- L10: Pendiente: ejecutar `pnpm e2e` en GitHub Actions (nunca corrió allí); pruebas de navegador de reautenticación (aún no hay acción sensible en la interfaz).
