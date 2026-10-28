# TODO: backlog de Compass hasta producción con credenciales reales

Backlog único, pensado para que cada persona pueda **tomar una tarea sin pisar a otra**. Sale de una revisión de solo lectura (2026-10-27) sobre `plan.md`, los ADR 0001 a 0030, `docs/`, `odd/tasks/` y el código. No se ejecutaron pruebas ni compilaciones: "en verde" es lo que declara el traspaso, no algo comprobado aquí (ver V01).

## Veredicto

El proyecto es viable y está bien cimentado: capas impuestas por lint, aislamiento por filas forzado en las 26 tablas, auditoría transaccional con negaciones, cookies y cabeceras sólidas. La fase 1b (la bóveda) concentra el riesgo y hoy no existe. Sobra alcance y ceremonia para un equipo de unas 3 personas; faltan decisiones de operación (nube, instancia única, anclaje de la auditoría) que no tienen ADR.

## Cómo tomar una tarea (para que nadie se interrumpa)

1. **Reclama antes de empezar.** Una tarea tomada se marca con tu nombre en la columna "Quién" (o con su tarea en ClickUp, cuando exista). Si ya tiene nombre, no la tomes: coordina primero.
2. **Una tarea por carril a la vez.** Las tareas del mismo **carril** tocan los mismos archivos o la misma decisión. No se trabajan en paralelo por personas distintas, aunque sus dependencias ya estén cumplidas. Tareas de carriles distintos sí pueden ir en paralelo.
3. **No se empieza lo que tiene dependencias abiertas.** La columna "Depende de" manda. Una tarea con una decisión (D) pendiente no se implementa "suponiendo" la respuesta.
4. **Rutas protegidas ⚠** (identidad, acceso, criptografía, auditoría, migraciones con aislamiento, CSP y cabeceras, revelación de secretos): solo por encargo humano explícito, con revisión adversarial de dos revisores. Las pruebas de autorización, criptografía y aislamiento las escribe o revisa una persona.
5. **Quién decide.** *Dueño* = decisión de negocio del dueño del producto. *Equipo* = decisión del equipo (incluye gasto, proveedores o dependencias nuevas). *Ing.* = decisión técnica que se registra como ADR.
6. **Tamaños relativos**, como en el traspaso: **S** (días), **M** (una a dos semanas), **L** (varias semanas). Son estimaciones iniciales y se revisan al empezar cada bloque.

### Definición de hecho por tipo

| Tipo | Está hecho cuando |
| --- | --- |
| ADR | Documento en `docs/adr/` con estado Aceptada, índice del ADR actualizado y las secciones del plan o del traspaso que lo contradecían corregidas |
| Decisión | Respuesta registrada por escrito (traspaso §5 o el ADR que la use) y quitada de "abiertas" |
| Código | Cumple "Terminado significa" de `CLAUDE.md`: formato, compilación, tipos, lint y pruebas en verde, más las pruebas de la capa tocada. No se toca ninguna prueba para que pase |
| Prueba | La escribe o revisa una persona; probada rompiendo la regla a propósito (una prueba debe fallar) |
| Verificación | Informe breve con cada afirmación como hecho verificado (archivo y línea) o suposición. Lo confirmado como defecto pasa a ser una tarea nueva |
| Doc | Texto alineado y comprobable con `rg`; sin código en los documentos de negocio |
| Ops | Procedimiento ejecutado o ensayado y su resultado anotado en el runbook |

### Carriles

| Carril | Qué toca |
| --- | --- |
| `ADR` | Solo `docs/adr/`. Dos personas pueden escribir ADR distintos a la vez |
| `AUDIT` | Módulo de auditoría y migración 0006 ⚠ |
| `IDENT` | Módulo de identidad y sesiones ⚠ |
| `CRYPTO` | Criptografía, KMS y configuración de arranque ⚠ |
| `VAULT` | Bóveda (B): en serie, una porción a la vez salvo que la dependencia diga lo contrario |
| `GOV` | Gobernanza (G): bajas, salud, acceso temporal, alertas |
| `OPS` | Infraestructura, runbooks, DNS, proveedor |
| `DOCS` | Texto en `plan.md`, `docs/`, `odd/`; un archivo por persona |
| `QA` | Verificaciones, pruebas y auditorías de solo lectura; casi siempre paralelizables |

Leyenda de evidencia en las notas: **[V]** verificado en código o documento; **[S]** suposición de la revisión, a confirmar.

---

## D. Decisiones y ADR

Barren el camino de la bóveda. Todas son "S" salvo que se indique.

| ID | Tarea | Tipo | Decide | Tam. | Depende de | Carril | Quién |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [ ] D01 | Decidir el ADR 0023 (bloqueo de auditoría en transacciones largas) e incluir cómo se agrupan las ráfagas de negaciones. Hoy "Propuesta"; con una sola organización el bloqueo serializa toda escritura sensible [V] | ADR ⚠ | Ing. | S | — | `ADR` | |
| [ ] D02 | Decidir el ADR 0024 (retención de auditoría frente a `REVOKE DELETE`) y el particionado: el ADR lo pide "desde la migración inicial" y la migración 0006 no lo tiene [V] | ADR ⚠ | Equipo (retención con área legal) | M | D01 | `ADR` | |
| [ ] D03 | ADR de anclaje externo de la cadena de auditoría: hoy SHA-256 sin clave dentro de un disparador, así que quien escriba la tabla puede recalcularla [V]. Decidir HMAC con clave del KMS o ancla periódica externa, con destino y frecuencia | ADR ⚠ | Ing. | M | D02 | `ADR` | |
| [ ] D04 | Límite de revelaciones por usuario y hora (el plan dice 30), qué alerta se emite al superarlo y su canal | ADR ⚠ | Dueño | S | — | `ADR` | |
| [ ] D05 | Reglas del motivo escrito al revelar: longitud mínima, texto libre o lista cerrada | Decisión ⚠ | Dueño | S | — | `ADR` | |
| [ ] D06 | Índice ciego: derivarlo de la DEK (obliga a reindexar en cada rotación) o de una clave estable por organización | ADR ⚠ | Ing. | S | — | `ADR` | |
| [ ] D07 | Permisos por defecto de Líder y Operador. Hoy un Operador puede revelar contraseñas y compartir, lo que anula "USE no revela" | Decisión ⚠ | Dueño | S | — | `ADR` | |
| [ ] D08 | Reautenticación: ¿acepta código de recuperación y passkey, además de TOTP? Quien perdió su app queda bloqueado para revelar y exportar | ADR ⚠ | Dueño | S | — | `ADR` | |
| [ ] D09 | Biblioteca para leer códigos QR en el navegador. Dependencia nueva: versión exacta y espera de 7 días | Decisión | Equipo | S | — | `ADR` | |
| [ ] D10 | Recorte de la primera entrega de 2FA: ¿se empieza con clave manual e imagen y se difieren captura de pestaña, Google Authenticator y entrega por celular? (ADR 0017 fija cinco métodos) [S] | Decisión | Dueño | S | — | `ADR` | |
| [ ] D11 | Instancia única o Redis: declarar y soportar una sola instancia, o incorporar Redis antes de la puerta de producción. Hoy choca con las 2 tareas mínimas de `plan.md:923` [V] | ADR | Equipo | S | D13 | `ADR` | |
| [ ] D12 | Nube: elegir proveedor y cerrar la confirmación pendiente del ADR 0020 | Decisión | Equipo | M | — | `ADR` | |
| [ ] D13 | Escala del primer año y disponibilidad requerida (RPO 5 min y RTO 4 h están "a validar") | Decisión | Dueño | S | — | `ADR` | |
| [ ] D14 | ADR de rotación de DEK y de índices ciegos, y qué pasa con las cachés de las otras instancias (TTL de 10 min) [S para el efecto entre instancias] | ADR ⚠ | Ing. | M | D06, D11 | `ADR` | |
| [ ] D15 | ADR de contexto de cifrado del KMS ligado a la organización, para que CloudTrail distinga usos anómalos [S] | ADR ⚠ | Ing. | S | D12 | `ADR` | |
| [ ] D16 | ADR sobre dónde corre el generador de TOTP (¿proceso aislado?). Un servidor comprometido produce códigos de todas las plataformas y anula el segundo factor de esas cuentas [S] | ADR ⚠ | Equipo | M | — | `ADR` | |
| [ ] D17 | ADR de eventos y outbox: entrega, idempotencia y orden. El plan los usa en todo y no tiene ADR | ADR | Ing. | M | — | `ADR` | |
| [ ] D18 | ADR del cálculo del acceso efectivo con grupos y vencimientos, y el costo de recálculo | ADR ⚠ | Ing. | M | — | `ADR` | |
| [ ] D19 | ADR de recuperación de la Raíz que pierde contraseña y factores, y de emisión de códigos de emergencia nuevos. Hoy no tiene recuperación en el sistema [V] | ADR ⚠ | Dueño + Equipo | M | — | `ADR` | |
| [ ] D20 | ADR de correos duplicados entre organizaciones: el correo es único global y no hay política (`plan.md:192`) [V] | ADR ⚠ | Equipo | S | — | `ADR` | |
| [ ] D21 | ADR del modelo de `identities` y `memberships` (anunciado en `docs/adr/README.md:55`) | ADR ⚠ | Ing. | S | — | `ADR` | |
| [ ] D22 | Listados de directorio y de gestión sin motor de autorización: `ListDirectory` no referencia `Authorizer` [V]. Es regla de negocio documentada pero choca con la letra de `CLAUDE.md`. Decidir si es una excepción escrita o si pasan por el motor | ADR ⚠ | Equipo | S | V03 | `ADR` | |
| [ ] D23 | Excepción de `node:crypto` en `db/src/migrate.ts` (checksums de migraciones) [V]: aceptarla por escrito o moverla | Decisión | Ing. | S | — | `ADR` | |
| [ ] D24 | Cierre formal de la fase 1a: hoy los documentos la describen de tres maneras ("funcionalmente completa", "en lo esencial", "aún no se sabe") | Decisión | Dueño | S | S02 a S06 | `DOCS` | |
| [ ] D25 | Presupuesto y proveedor de la prueba de intrusión externa | Decisión | Dueño | S | — | `OPS` | |
| [ ] D26 | Identidad de las dos personas que custodian los códigos de emergencia | Decisión | Dueño | S | — | `OPS` | |
| [ ] D27 | Política de retención de auditoría y versiones de secretos, validada con el área legal | Decisión | Dueño | M | — | `OPS` | |
| [ ] D28 | Subdominio para los alias de cuentas | Decisión | Equipo | S | — | `OPS` | |
| [ ] D29 | Equipo de guardia ante incidentes: quién y cómo se le avisa | Decisión | Dueño | S | — | `OPS` | |
| [ ] D30 | Preguntas menores abiertas (traspaso §5): responsable de la persona invitada, efecto de archivar un rol, rango visible en el directorio, PostgreSQL 17 o 18, prueba corta de proveedor SSO sobre Fastify (antes de la fase 2) | Decisión | Dueño / Equipo | S | — | `ADR` | |
| [ ] D31 | Exigir passkeys a la Raíz y a los Administradores como configuración de la organización, y si la reautenticación admite passkey (ADR 0028 lo deja para después) | Decisión | Dueño | S | D08 | `ADR` | |

## V. Verificaciones y auditorías (solo lectura, casi todas en paralelo)

Cubren lo que los lectores de esta revisión **no** alcanzaron a verificar. Cada hallazgo confirmado abre una tarea nueva.

| ID | Tarea | Tipo | Decide | Tam. | Depende de | Carril | Quién |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [ ] V01 | Línea base: ejecutar formato, compilación, tipos, lint y pruebas (y `pnpm e2e`) y registrar el resultado y la fecha. Hoy nadie lo ha comprobado en esta revisión. Requiere permiso expreso para correr pruebas | Verificación | Ing. | S | — | `QA` | |
| [ ] V02 | Revisar `SessionService.authenticate`: expiración, rotación y estado del usuario (suspendido o desactivado) | Verificación ⚠ | Ing. | S | — | `QA` | |
| [ ] V03 | Revisar los filtros de jerarquía en `pg-user-directory.ts` y en `ListManaged`, y si `ListDirectory` valida el estado del actor [S] | Verificación ⚠ | Ing. | S | — | `QA` | |
| [ ] V04 | Confirmar qué cuerpos guarda `idempotency_keys` y que ninguna respuesta con secretos se almacene | Verificación ⚠ | Ing. | S | — | `QA` | |
| [ ] V05 | Revisar el resto de los repositorios y el uso del contexto de organización en cada uno | Verificación ⚠ | Ing. | M | — | `QA` | |
| [ ] V06 | Confirmar en código las hipótesis marcadas [S]: caché de DEK por instancia y su invalidación, uso del contexto de cifrado del KMS, comportamiento de `trustProxy` | Verificación ⚠ | Ing. | S | — | `QA` | |
| [ ] V07 | Auditar el frontend (unas 6.900 líneas): accesibilidad, textos en es-MX y en-US, uso exclusivo del sistema de diseño y de la tabla estándar | Verificación | Ing. | M | — | `QA` | |
| [ ] V08 | Auditar la cadena de suministro: dependencias, archivo de bloqueo, antigüedad de 7 días y escáneres que pide el plan | Verificación | Equipo | M | — | `QA` | |
| [ ] V09 | Auditar observabilidad: qué se registra, métricas y alertas. Hoy no hay un criterio escrito | Verificación | Ing. | M | — | `QA` | |
| [ ] V10 | Revisar privacidad y cumplimiento de los datos personales que guarda el sistema (nombres, correos) con el área legal | Verificación | Dueño | M | — | `QA` | |

## S. Cierre de la fase 1a y deuda de código

| ID | Tarea | Tipo | Decide | Tam. | Depende de | Carril | Quién |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [ ] S01 | Guardarraíl de producción para la KEK local: `config.ts` impide `MAIL_TRANSPORT=log` en producción pero no `LocalKeyManagement`, que `main.http.ts` instancia siempre [V]. Hoy es riesgo futuro, no actual | Código ⚠ | Ing. | S | — | `CRYPTO` | |
| [ ] S02 | Purga de filas vencidas de `idempotency_keys` y `webauthn_challenges` (incluye un ADR corto sobre el recorrido de organizaciones, `docs/database.md` §7.5) [V] | Código ⚠ + ADR | Ing. | M | D17 | `IDENT` | |
| [ ] S03 | Límites de intentos: implementar Redis o, si D11 declara instancia única, un guardarraíl de arranque que lo haga cumplir y documente. Hoy viven en memoria por instancia y un reinicio borra los bloqueos [V] | Código ⚠ | Ing. | M | D11 | `IDENT` | |
| [ ] S04 | Recuperar a la Raíz sin factores y emitir códigos de emergencia nuevos (mecanismo y runbook) | Código ⚠ | Ing. | M | D19 | `IDENT` | |
| [ ] S05 | Reautenticación con código de recuperación y passkey, según D08 | Código ⚠ | Ing. | M | D08 | `IDENT` | |
| [ ] S06 | Editar roles personalizados ya creados (A6 lo dejó pendiente) | Código ⚠ | Ing. | M | D07 | `IDENT` | |
| [ ] S07 | Prueba de matriz de autorización por ruta: que falle si un controlador nuevo carece de guarda. Hoy la "rotura intencional" es manual [V: no encontré una prueba así] | Prueba ⚠ | Ing. | M | — | `QA` | |
| [ ] S08 | Pruebas unitarias propias para `idempotency` (363 líneas) y `organization` (159). Hoy solo se ejercen vía integración y e2e [V] | Prueba ⚠ | Ing. | S | — | `QA` | |
| [ ] S09 | Redacción de logs más robusta: hoy depende de nombres de clave y profundidad 0 a 2; `LogMailer` registra `link` con token protegido solo por el bloqueo de producción [V] | Código ⚠ | Ing. | S | — | `IDENT` | |
| [ ] S10 | Poner razón y responsable al único `TODO` real (`apps/web/src/shared/api/api-error.ts:1`) [V], contra la regla de `CLAUDE.md` | Código | Ing. | S | — | `QA` | |
| [ ] S11 | Reemplazar el texto del esqueleto de la fase 0 en la pantalla de inicio (en es-MX y en-US) | Código | Ing. | S | — | `QA` | |
| [ ] S12 | Primera ejecución del CI en GitHub, corregir lo que falle y añadir los escáneres de seguridad. El dueño lo despriorizó; la puerta de producción lo vuelve necesario. Subir al remoto es decisión del equipo | Código | Equipo | S | V08 | `OPS` | |
| [ ] S13 | Exigir passkeys como configuración de la organización (pantalla de configuración incluida) | Código ⚠ | Dueño | M | D31 | `IDENT` | |

## B. Fase 1b: bóveda y segundo factor

Se trabaja en serie dentro del carril `VAULT`. El orden **cambia** respecto a `odd/tasks/phase-1b-vault.md`: compartir se acerca a credenciales, y B2 y B4 se parten por ser las más cargadas [S]. Cada porción es vertical: casos de uso, API, pantalla, pruebas y documentación.

| ID | Tarea | Tipo | Decide | Tam. | Depende de | Carril | Quién |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [ ] B00 | Criterios de aceptación medibles para B01 a B09 en `odd/tasks/phase-1b-vault.md`: rendimiento del listado por acceso efectivo, qué ve quien tiene `inventory`, efecto de archivar una cuenta, duración y desbloqueo tras superar el límite de revelaciones. Añadir el ADR 0023 como prerrequisito | Doc | Equipo | S | D01, D04, D07 | `DOCS` | |
| [ ] B01 | **B1** Acceso efectivo y cuentas: catálogo de plataformas (lectura), crear, editar y archivar cuentas, listado filtrado por acceso efectivo y pantalla de cuentas | Código ⚠ | — | M | B00, D01, D07, D18 | `VAULT` | |
| [ ] B02 | **B2a** Credenciales: crear, cambiar contraseña con versiones y huella, historial sin contenido, copiar usuario | Código ⚠ | — | M | B01, D06, D17 | `VAULT` | |
| [ ] B03 | **B3** Compartición y grupos: por persona y por grupo, caducidad, no compartir más de lo propio. Incluye dónde vive la tarea de rotación al revocar mientras no exista G02 | Código ⚠ | — | M | B01, D17, D18 | `VAULT` | |
| [ ] B04 | **B2b** Revelar contraseña: reautenticación, motivo, límite por hora, alerta al superarlo y ocultado a los 30 s | Código ⚠ | — | M | B02, B03, D04, D05, D08 (S05) | `VAULT` | |
| [ ] B05 | **B4a** Segundo factor en el servidor: registro (validación, confirmación, pendiente 24 h), código bajo demanda, exportar, re-registrar y retirar; registro por clave manual | Código ⚠ | — | L | B02, D10, D16 | `VAULT` | |
| [ ] B06 | **B4b** Registro del segundo factor por imagen del QR | Código ⚠ | — | M | B05, D09 | `VAULT` | |
| [ ] B07 | **B5** Captura de pestaña, importación de Google Authenticator y entrega por celular (según el recorte de D10) | Código ⚠ | — | M | B06, D10 | `VAULT` | |
| [ ] B08 | **B6** Búsqueda avanzada, índice ciego por usuario y vistas guardadas | Código ⚠ | — | M | B02, D06 | `VAULT` | |
| [ ] B09 | **B7** Importación por CSV | Código | — | S | B02 | `VAULT` | |
| [ ] B10 | Restaurar una versión de la credencial (BO-7). Hoy no está asignada a ninguna porción [V] | Código ⚠ | — | S | B02 | `VAULT` | |
| [ ] B11 | Punto de entrada del worker (no existe): purga de versiones a los 30 días y aviso de 24 h de un segundo factor pendiente | Código | Equipo | M | D12 | `OPS` | |

## G. Fase 1c: gobernanza

| ID | Tarea | Tipo | Decide | Tam. | Depende de | Carril | Quién |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [ ] G01 | Auditoría con pantalla y verificación de la cadena | Código ⚠ | — | L | D03, B04 | `AUDIT` | |
| [ ] G02 | Bajas con tareas de rotación de secretos. Decidir qué pasa si la persona dada de baja era la única gestora de una cuenta (sin asignatario) | Código ⚠ | Dueño | L | B03, D17 | `GOV` | |
| [ ] G03 | Salud de credenciales | Código | — | M | B02 | `GOV` | |
| [ ] G04 | Acceso temporal (JIT) | Código ⚠ | — | M | B03 | `GOV` | |
| [ ] G05 | Alertas críticas, incluida la de superar el límite de revelaciones | Código ⚠ | — | M | G06, D04 | `GOV` | |
| [ ] G06 | Avisos de correo que faltan: dispositivo nuevo, uso de código de recuperación y cambios de factores | Código ⚠ | — | M | G07 | `GOV` | |
| [ ] G07 | SPF, DKIM y DMARC del dominio de correo, para que los avisos lleguen a la bandeja | Ops | Equipo | S | — | `OPS` | |
| [ ] G08 | Transferencia de la Raíz: hoy no pertenece a ninguna fase (`transfer-root.md` la ubica en 1c y los criterios de 1c no la incluyen) [V]. Asignarla a 1c e implementarla | Código ⚠ | Dueño | M | S04 | `IDENT` | |

## P. Puerta de producción

**Hasta cerrar todo lo anterior y pasar la prueba de intrusión: no cargar ninguna credencial real.**

| ID | Tarea | Tipo | Decide | Tam. | Depende de | Carril | Quién |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [ ] P01 | Adaptador de KMS de producción (el local se niega a arrancar con `NODE_ENV=production`, así que la API hoy no arranca así) [V] | Código ⚠ | — | L | D12, D15, S01 | `CRYPTO` | |
| [ ] P02 | Definir los comandos "por definir" de los runbooks: rotar DEK, restaurar respaldo, fuga de base de datos, usuario o servidor comprometido, transferir la Raíz | Ops | Ing. | M | D14 | `OPS` | |
| [ ] P03 | Runbooks que faltan: caída total con sobres sellados, pérdida o borrado de la KEK, restauración con el KMS, y regeneración de la contraseña inicial extraviada de la Raíz | Ops | Ing. | M | D29, S04 | `OPS` | |
| [ ] P04 | Ensayar todos los runbooks (hoy los 9 están como borrador "sin ensayar" [V]) | Ops | Equipo | M | P02, P03 | `OPS` | |
| [ ] P05 | Simulacro de restauración completo, incluida la apertura de secretos con las claves | Ops | Equipo | M | P01, P02 | `OPS` | |
| [ ] P06 | Guía de `trustProxy`: detrás de un balanceador todos comparten la IP; mal activado, se falsifica [S] | Doc | Ing. | S | V06 | `OPS` | |
| [ ] P07 | Prueba de intrusión externa sin hallazgos altos o críticos abiertos | Ops | Dueño | L | todo B, G y S, P01, P05, D25 | `OPS` | |
| [ ] P08 | Reevaluar las fases 3 (SAML con Meta), 4 (correo con DKIM y cuarentena) y 7 (broker, que el plan llama frágil): son productos aparte. No comprometer diseño ni estimaciones antes de P07 [S] | Decisión | Dueño | S | P07 | `DOCS` | |

## X. Documentación desalineada (solo texto)

Seguras de paralelizar: un archivo por persona.

| ID | Tarea | Tipo | Decide | Tam. | Depende de | Carril | Quién |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [ ] X01 | `plan.md`: passkeys obligatorias a Raíz y Administradores (`:471`, `:1042`) y "con passkey la reautenticación es un toque" (`:484`), contra el ADR 0028; y "20 ADR iniciales" (`:834`), cuando ya hay 30 | Doc | Ing. | S | D08, D31 | `DOCS` | |
| [ ] X02 | `docs/threat-model.md`: marca como "Planeada" el cifrador, la caché de DEK y la cadena de auditoría, que ya existen [V] | Doc | Ing. | S | — | `DOCS` | |
| [ ] X03 | `docs/handoff.md` dice "ADR 0001 a 0024" y repite el párrafo del tamaño de JavaScript (200,04 KB) dos veces; `docs/business/roadmap-and-status.md` dice "0001 a 0020". El índice real es 0001 a 0030 | Doc | Ing. | S | — | `DOCS` | |
| [ ] X04 | `docs/business/authentication.md`: llama "preferida" a la passkey y describe el restablecimiento "por el responsable" como si existiera; `roadmap-and-status.md` marca "Cumplido" el segundo factor obligatorio con solo TOTP | Doc | Ing. | S | D19, D31 | `DOCS` | |
| [ ] X05 | `odd/tasks/phase-1a-closure.md`: las notas L2 y L3 ("A3 parcial", "siguen abiertas A2, A8, A9") solo se corrigen con una nota final | Doc | Ing. | S | — | `DOCS` | |
| [ ] X06 | `docs/runbooks/README.md` lista 9 borradores y `roadmap-and-status.md` §5 pide "los cinco procedimientos más el de caída total": unificar el criterio | Doc | Ing. | S | — | `DOCS` | |

---

## Camino crítico

La bóveda se desbloquea con pocas decisiones baratas y paralelas. Lo que **no** depende de ellas puede avanzar desde ya.

1. **En paralelo, ahora:** D01, D04, D05, D06, D07, D08, D09, D10, D12, D16, D17, D18, V01 a V10, S01, S10, S11 y las X.
2. **Con D01, D04, D07 y D18 cerradas:** B00 y luego `B01 → B02 → B03 → B04` en el carril `VAULT`.
3. **En paralelo a la bóveda:** cierre de 1a (S02 a S06, S13), decisiones de nube y operación (D11 a D15), y G07.
4. **Después de la bóveda:** B05 a B11, luego G y P.
5. **Cierre:** P04, P05, P07 y, solo entonces, credenciales reales.

## Qué NO se verificó en esta revisión

- Que formato, compilación, tipos, lint y pruebas pasen hoy (V01).
- Las zonas listadas en V02 a V06.
- Las suposiciones marcadas [S]: son hipótesis a confirmar, no defectos probados.
