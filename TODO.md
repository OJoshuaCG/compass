# TODO: backlog de Compass hasta producción con credenciales reales

Backlog único, ordenado para que cualquier persona (o agente de IA) pueda **tomar una tarea sin pisar a otra**. Sale de una revisión de solo lectura (2026-10-27) sobre `plan.md`, los ADR 0001 a 0030, `docs/`, `odd/tasks/` y el código. No se ejecutaron pruebas ni compilaciones: "en verde" es lo que declara el traspaso, no algo comprobado aquí (ver A1).

## Veredicto

El proyecto es viable y está bien cimentado: capas impuestas por lint, aislamiento por filas forzado en las 26 tablas, auditoría transaccional con negaciones, cookies y cabeceras sólidas. La fase 1b (la bóveda) concentra el riesgo y hoy no existe. Sobra alcance y ceremonia para un equipo de unas 3 personas; faltan decisiones de operación (nube, instancia única, anclaje de la auditoría) que no tienen ADR.

## Cómo se organiza (léelo una vez)

- **Cada letra es una épica** (A, B, C…). **Las letras en orden alfabético son el orden de ejecución.**
- **Cada épica tiene subtareas numeradas**: A1, A2, A3… El ID de una subtarea no cambia nunca.
- **Los niveles agrupan letras consecutivas.** Las épicas del mismo nivel son **independientes entre sí**: una persona puede tomar la A y otra la C a la vez sin afectarse.
- **Una épica solo depende de épicas de niveles anteriores.** Nunca depende de una posterior ni de otra de su mismo nivel.
- **"Requiere" es el mínimo para empezar.** No hace falta terminar el nivel anterior completo: si la épica K dice "Requiere: B, I", basta con tener B e I terminadas, aunque falte el resto de su nivel.
- **Dentro de una épica**, las subtareas son independientes salvo que la columna "Depende de" cite a otra subtarea de la misma épica (por ejemplo, N2 depende de N1). Esas se hacen en orden.
- **Las dependencias exactas viven en cada subtarea**; el "Requiere" de la épica es su resumen.

## Mapa de niveles y épicas

| Nivel | Épica | Título | Requiere | Subtareas |
| --- | --- | --- | --- | --- |
| **1 · Arranque** (todo en paralelo, sin dependencias) | A | Línea base y verificaciones | nada | 10 |
| | B | Decisiones de la bóveda | nada | 11 |
| | C | Decisiones de plataforma y operación | nada | 12 |
| | D | Deuda menor de código y correo del dominio | nada | 7 |
| | E | Documentación sin dependencias | nada | 4 |
| **2 · Desbloqueo** (solo depende del nivel 1) | F | Decisiones derivadas | A, B, C | 7 |
| | G | Cierre de identidad (parte 1) | B, C, D | 6 |
| | H | Infraestructura base | A, C | 3 |
| | I | Bóveda: cuentas | B | 2 |
| **3 · Cimientos** (depende de niveles 1 y 2) | J | Cierre de identidad (parte 2) y documentación | B, C, F, G | 6 |
| | K | Bóveda: credenciales y compartición | B, I | 2 |
| | L | Operación: KMS y runbooks | C, D, F, G | 3 |
| **4 · Bóveda y operación en paralelo** | M | Revelar y restaurar credenciales | B, K | 2 |
| | N | Segundo factor | B, K | 3 |
| | O | Búsqueda e importación | B, K | 2 |
| | P | Gobernanza base | B, K | 3 |
| | Q | Ensayos de operación | L | 2 |
| **5 · Cierre de gobernanza** | R | Auditoría y alertas críticas | B, F, G, M | 2 |
| **6 · Puerta de producción** | S | Prueba de intrusión y producción | todas | 2 |

Total: **89 subtareas** en **19 épicas**.

## Reglas para tomar una tarea

1. **Elige una subtarea con `[ ]`, sin nombre en "Quién", cuya épica ya tenga su "Requiere" terminado y cuyas dependencias estén en `[x]`.** Escribe tu nombre en "Quién" antes de empezar. Si ya tiene nombre, no la tomes: coordina primero.
2. **Estados:** `[ ]` pendiente, `[~]` en curso (con nombre), `[x]` hecha. Marca `[x]` solo cuando se cumple la definición de hecho de su tipo (abajo).
3. **No se implementa suponiendo una decisión abierta.** Una subtarea de código con una decisión pendiente en "Depende de" espera a que esa decisión esté tomada y escrita.
4. **Rutas protegidas ⚠** (identidad, acceso, criptografía, auditoría, migraciones con aislamiento, CSP y cabeceras, revelación de secretos): solo por encargo humano explícito y con revisión adversarial de dos revisores. Las pruebas de autorización, criptografía y aislamiento las escribe o las revisa una persona.
5. **Quién decide.** *Dueño* = decisión de negocio. *Equipo* = decisión del equipo (gasto, proveedores, dependencias nuevas). *Ing.* = decisión técnica que se registra como ADR.
6. **Misma zona, mismo nivel.** Dos épicas del mismo nivel pueden tocar la misma zona de código (se indica en cada épica). Son independientes en lógica, pero avisa en "Quién" para no chocar en la misma migración o archivo.
7. **Tamaños relativos:** **S** (días), **M** (una a dos semanas), **L** (varias semanas). Son estimaciones iniciales mías, no del equipo, y se revisan al empezar cada bloque.

### Protocolo para agentes de IA

Para elegir qué hacer: (1) lee la tabla "Mapa de niveles"; (2) toma la letra más baja cuya épica tenga el "Requiere" terminado; (3) dentro de ella, la primera subtarea `[ ]` sin "Quién" con todas sus dependencias en `[x]`; (4) si es ⚠, **detente y pide encargo humano** antes de modificar nada; (5) si es una decisión (tipo ADR o Decisión), no la tomes por tu cuenta: prepara las opciones con sus tradeoffs y espera al "Decide" indicado; (6) no ejecutes pruebas ni compilaciones sin permiso expreso del usuario en el turno; (7) no subas nada al remoto.

### Definición de hecho por tipo

| Tipo | Está hecho cuando |
| --- | --- |
| ADR | Documento en `docs/adr/` con estado Aceptada, índice de ADR actualizado y las secciones del plan o del traspaso que lo contradecían corregidas |
| Decisión | Respuesta registrada por escrito (traspaso §5 o el ADR que la use) y quitada de "abiertas" |
| Código | Cumple "Terminado significa" de `CLAUDE.md`: formato, compilación, tipos, lint y pruebas en verde, más las pruebas de la capa tocada. No se toca ninguna prueba para que pase |
| Prueba | La escribe o revisa una persona; probada rompiendo la regla a propósito (alguna prueba debe fallar) |
| Verificación | Informe breve con cada afirmación como hecho verificado (archivo y línea) o suposición. Lo confirmado como defecto abre una subtarea nueva en la épica que corresponda |
| Doc | Texto alineado y comprobable con `rg`; sin código en los documentos de negocio |
| Ops | Procedimiento ejecutado o ensayado y su resultado anotado en el runbook |

Leyenda de evidencia en las notas: **[V]** verificado en código o documento; **[S]** suposición de la revisión, a confirmar.

---

# NIVEL 1 · Arranque

Todo se puede empezar hoy y en paralelo: A, B, C, D y E no dependen de nada.

## A · Línea base y verificaciones

**Nivel** 1 · **Requiere:** nada · **En paralelo con:** B, C, D, E · **Zona:** solo lectura

Cubren lo que los lectores de esta revisión **no** alcanzaron a verificar. Cada hallazgo confirmado abre una subtarea nueva. Todas son independientes entre sí.

| ID | Tarea | Tipo | Decide | Tam. | Depende de | Quién |
| --- | --- | --- | --- | --- | --- | --- |
| [~] A1 | Línea base: ejecutar formato, compilación, tipos, lint y pruebas (y `pnpm e2e`) y registrar resultado y fecha. **2026-10-27, Node 24.22.1:** `format:check`, `build`, `typecheck` y `lint` en verde; `pnpm test` en verde (1.052 pruebas: api 612, web 295, db 55, ui 60, i18n 17, contracts 13). **Falta `pnpm e2e`:** el equipo no tiene Google Chrome (`/opt/google/chrome/chrome`), es un fallo de entorno, no de código. Se cierra al instalar Chrome y correrlo | Verificación | Ing. | S | — | Claude |
| [ ] A2 | Revisar `SessionService.authenticate`: expiración, rotación y estado del usuario (suspendido o desactivado) | Verificación ⚠ | Ing. | S | — | |
| [ ] A3 | Revisar los filtros de jerarquía en `pg-user-directory.ts` y en `ListManaged`, y si `ListDirectory` valida el estado del actor [S] | Verificación ⚠ | Ing. | S | — | |
| [ ] A4 | Confirmar qué cuerpos guarda `idempotency_keys` y que ninguna respuesta con secretos se almacene | Verificación ⚠ | Ing. | S | — | |
| [ ] A5 | Revisar el resto de los repositorios y el uso del contexto de organización en cada uno | Verificación ⚠ | Ing. | M | — | |
| [ ] A6 | Confirmar en código las hipótesis marcadas [S]: caché de DEK por instancia y su invalidación, uso del contexto de cifrado del KMS, comportamiento de `trustProxy` | Verificación ⚠ | Ing. | S | — | |
| [ ] A7 | Auditar el frontend (unas 6.900 líneas): accesibilidad, textos en es-MX y en-US, uso exclusivo del sistema de diseño y de la tabla estándar | Verificación | Ing. | M | — | |
| [ ] A8 | Auditar la cadena de suministro: dependencias, archivo de bloqueo, antigüedad de 7 días y escáneres que pide el plan | Verificación | Equipo | M | — | |
| [ ] A9 | Auditar observabilidad: qué se registra, métricas y alertas. Hoy no hay un criterio escrito | Verificación | Ing. | M | — | |
| [ ] A10 | Revisar privacidad y cumplimiento de los datos personales que guarda el sistema (nombres, correos), con el área legal | Verificación | Dueño | M | — | |

## B · Decisiones de la bóveda

**Nivel** 1 · **Requiere:** nada · **En paralelo con:** A, C, D, E · **Zona:** `docs/adr/`

Decisiones baratas que desbloquean la fase 1b. Todas independientes entre sí.

| ID | Tarea | Tipo | Decide | Tam. | Depende de | Quién |
| --- | --- | --- | --- | --- | --- | --- |
| [x] B1 | Decidir el ADR 0023 (bloqueo de auditoría en transacciones largas). **Hecha 2026-10-27:** aceptada la opción 1 con `lock_timeout` de 5 s y falla cerrada. Quedan abiertos, y salen de esta subtarea: implementar el `lock_timeout` (⚠ encargo humano), medir latencia p95, revisar el orden de auditoría en `DeactivateUser` y decidir la agrupación de negaciones repetidas (ver "Pendiente" del ADR) | ADR ⚠ | Ing. | S | — | Claude |
| [ ] B2 | Límite de revelaciones por usuario y hora (el plan dice 30), qué alerta se emite al superarlo y su canal | ADR ⚠ | Dueño | S | — | |
| [ ] B3 | Reglas del motivo escrito al revelar: longitud mínima, texto libre o lista cerrada | Decisión ⚠ | Dueño | S | — | |
| [ ] B4 | Índice ciego: derivarlo de la DEK (obliga a reindexar en cada rotación) o de una clave estable por organización [V: `plan.md:434`] | ADR ⚠ | Ing. | S | — | |
| [ ] B5 | Permisos por defecto de Líder y Operador. Hoy un Operador puede revelar contraseñas y compartir, lo que anula "USE no revela" | Decisión ⚠ | Dueño | S | — | |
| [ ] B6 | Reautenticación: ¿acepta código de recuperación y passkey, además de TOTP? Quien perdió su app queda bloqueado para revelar y exportar | ADR ⚠ | Dueño | S | — | |
| [ ] B7 | Biblioteca para leer códigos QR en el navegador. Dependencia nueva: versión exacta y espera de 7 días | Decisión | Equipo | S | — | |
| [ ] B8 | Recorte de la primera entrega de 2FA: ¿clave manual e imagen primero, y diferir captura de pestaña, Google Authenticator y entrega por celular? (el ADR 0017 fija cinco métodos) [S] | Decisión | Dueño | S | — | |
| [ ] B9 | ADR sobre dónde corre el generador de TOTP (¿proceso aislado?). Un servidor comprometido produce códigos de todas las plataformas y anula el segundo factor de esas cuentas [S] | ADR ⚠ | Equipo | M | — | |
| [ ] B10 | ADR de eventos y outbox: entrega, idempotencia y orden. El plan los usa en todo y no tiene ADR | ADR | Ing. | M | — | |
| [ ] B11 | ADR del cálculo del acceso efectivo con grupos y vencimientos, y el costo de recálculo | ADR ⚠ | Ing. | M | — | |

## C · Decisiones de plataforma y operación

**Nivel** 1 · **Requiere:** nada · **En paralelo con:** A, B, D, E · **Zona:** `docs/adr/` y decisiones de negocio

| ID | Tarea | Tipo | Decide | Tam. | Depende de | Quién |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] C1 | Nube: elegir proveedor y cerrar la confirmación pendiente del ADR 0020 | Decisión | Equipo | M | — | |
| [ ] C2 | Escala del primer año y disponibilidad requerida (RPO 5 min y RTO 4 h están "a validar") | Decisión | Dueño | S | — | |
| [ ] C3 | ADR de recuperación de la Raíz que pierde contraseña y factores, y de emisión de códigos de emergencia nuevos. Hoy no tiene recuperación en el sistema [V] | ADR ⚠ | Dueño | M | — | |
| [ ] C4 | ADR de correos duplicados entre organizaciones: el correo es único global y no hay política (`plan.md:192`) [V] | ADR ⚠ | Equipo | S | — | |
| [ ] C5 | ADR del modelo de `identities` y `memberships` (anunciado en `docs/adr/README.md:55`) | ADR ⚠ | Ing. | S | — | |
| [ ] C6 | Excepción de `node:crypto` en `db/src/migrate.ts` (checksums de migraciones) [V]: aceptarla por escrito o moverla | Decisión | Ing. | S | — | |
| [ ] C7 | Presupuesto y proveedor de la prueba de intrusión externa | Decisión | Dueño | S | — | |
| [ ] C8 | Identidad de las dos personas que custodian los códigos de emergencia | Decisión | Dueño | S | — | |
| [ ] C9 | Política de retención de auditoría y versiones de secretos, validada con el área legal | Decisión | Dueño | M | — | |
| [ ] C10 | Subdominio para los alias de cuentas | Decisión | Equipo | S | — | |
| [ ] C11 | Equipo de guardia ante incidentes: quién y cómo se le avisa | Decisión | Dueño | S | — | |
| [ ] C12 | Preguntas menores abiertas (traspaso §5): responsable de la persona invitada, efecto de archivar un rol, rango visible en el directorio, PostgreSQL 17 o 18, prueba corta de proveedor SSO sobre Fastify (antes de la fase 2) | Decisión | Dueño / Equipo | S | — | |

## D · Deuda menor de código y correo del dominio

**Nivel** 1 · **Requiere:** nada · **En paralelo con:** A, B, C, E · **Zona:** API (configuración y logging), pruebas, DNS

| ID | Tarea | Tipo | Decide | Tam. | Depende de | Quién |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] D1 | Guardarraíl de producción para la KEK local: `config.ts` impide `MAIL_TRANSPORT=log` en producción pero no `LocalKeyManagement`, que `main.http.ts` instancia siempre [V]. Hoy es riesgo futuro, no actual | Código ⚠ | Ing. | S | — | |
| [ ] D2 | Prueba de matriz de autorización por ruta: que falle si un controlador nuevo carece de guarda. Hoy la "rotura intencional" es manual [V: no encontré una prueba así] | Prueba ⚠ | Ing. | M | — | |
| [ ] D3 | Pruebas unitarias propias para `idempotency` (363 líneas) y `organization` (159). Hoy solo se ejercen vía integración y e2e [V] | Prueba ⚠ | Ing. | S | — | |
| [ ] D4 | Redacción de logs más robusta: hoy depende de nombres de clave y profundidad 0 a 2; `LogMailer` registra `link` con token, protegido solo por el bloqueo de producción [V] | Código ⚠ | Ing. | S | — | |
| [ ] D5 | Poner razón y responsable al único `TODO` real (`apps/web/src/shared/api/api-error.ts:1`) [V], contra la regla de `CLAUDE.md` | Código | Ing. | S | — | |
| [ ] D6 | Reemplazar el texto del esqueleto de la fase 0 en la pantalla de inicio (en es-MX y en-US) | Código | Ing. | S | — | |
| [ ] D7 | SPF, DKIM y DMARC del dominio de correo, para que los avisos lleguen a la bandeja | Ops | Equipo | S | — | |

## E · Documentación sin dependencias

**Nivel** 1 · **Requiere:** nada · **En paralelo con:** A, B, C, D · **Zona:** documentos (un archivo por persona)

| ID | Tarea | Tipo | Decide | Tam. | Depende de | Quién |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] E1 | `docs/threat-model.md` marca como "Planeada" el cifrador, la caché de DEK y la cadena de auditoría, que ya existen [V] | Doc | Ing. | S | — | |
| [ ] E2 | `docs/handoff.md` dice "ADR 0001 a 0024" y repite el párrafo del tamaño de JavaScript (200,04 KB) dos veces; `docs/business/roadmap-and-status.md` dice "0001 a 0020". El índice real es 0001 a 0030 | Doc | Ing. | S | — | |
| [ ] E3 | `odd/tasks/phase-1a-closure.md`: las notas L2 y L3 ("A3 parcial", "siguen abiertas A2, A8, A9") solo se corrigen con una nota final | Doc | Ing. | S | — | |
| [ ] E4 | `docs/runbooks/README.md` lista 9 borradores y `roadmap-and-status.md` §5 pide "los cinco procedimientos más el de caída total": unificar el criterio | Doc | Ing. | S | — | |

---

# NIVEL 2 · Desbloqueo

Solo dependen del nivel 1. F, G, H e I son independientes entre sí.

## F · Decisiones derivadas

**Nivel** 2 · **Requiere:** A, B, C · **En paralelo con:** G, H, I · **Zona:** `docs/adr/`

| ID | Tarea | Tipo | Decide | Tam. | Depende de | Quién |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] F1 | Decidir el ADR 0024 (retención de auditoría frente a `REVOKE DELETE`) y el particionado: el ADR lo pide "desde la migración inicial" y la migración 0006 no lo tiene [V] | ADR ⚠ | Equipo (retención con área legal) | M | B1 | |
| [ ] F2 | ADR de anclaje externo de la cadena de auditoría: hoy SHA-256 sin clave dentro de un disparador, así que quien escriba la tabla puede recalcularla [V]. Decidir HMAC con clave del KMS o ancla periódica externa, con destino y frecuencia | ADR ⚠ | Ing. | M | F1 | |
| [ ] F3 | Instancia única o Redis: declarar y soportar una sola instancia, o incorporar Redis antes de la puerta de producción. Hoy choca con las 2 tareas mínimas de `plan.md:923` [V] | ADR | Equipo | S | C2 | |
| [ ] F4 | ADR de rotación de DEK y de índices ciegos, y qué pasa con las cachés de las otras instancias (TTL de 10 min) [S para el efecto entre instancias] | ADR ⚠ | Ing. | M | B4, F3 | |
| [ ] F5 | ADR de contexto de cifrado del KMS ligado a la organización, para que CloudTrail distinga usos anómalos [S] | ADR ⚠ | Ing. | S | C1 | |
| [ ] F6 | Listados de directorio y de gestión sin motor de autorización: `ListDirectory` no referencia `Authorizer` [V]. Es regla de negocio documentada pero choca con la letra de `CLAUDE.md`. Decidir si es una excepción escrita o si pasan por el motor | ADR ⚠ | Equipo | S | A3 | |
| [ ] F7 | Exigir passkeys a la Raíz y a los Administradores como configuración de la organización, y si la reautenticación admite passkey (el ADR 0028 lo deja para después) | Decisión | Dueño | S | B6 | |

## G · Cierre de identidad (parte 1)

**Nivel** 2 · **Requiere:** B, C, D · **En paralelo con:** F, H, I · **Zona:** módulo de identidad y notificación ⚠

| ID | Tarea | Tipo | Decide | Tam. | Depende de | Quién |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] G1 | Purga de filas vencidas de `idempotency_keys` y `webauthn_challenges` (incluye un ADR corto sobre el recorrido de organizaciones, `docs/database.md` §7.5) [V] | Código ⚠ + ADR | Ing. | M | B10 | |
| [ ] G2 | Recuperar a la Raíz sin factores y emitir códigos de emergencia nuevos (mecanismo y runbook) | Código ⚠ | Ing. | M | C3 | |
| [ ] G3 | Reautenticación con código de recuperación y passkey, según la decisión B6 | Código ⚠ | Ing. | M | B6 | |
| [ ] G4 | Editar roles personalizados ya creados (A6 del cierre de 1a lo dejó pendiente) | Código ⚠ | Ing. | M | B5 | |
| [ ] G5 | Avisos de correo que faltan: dispositivo nuevo, uso de código de recuperación y cambios de factores | Código ⚠ | Ing. | M | D7 | |
| [ ] G6 | Cumplir el ADR 0023: implementar el `lock_timeout` de 5 s con falla cerrada y error de dominio (con su prueba), medir la latencia p95 de las acciones sensibles con escritores concurrentes, revisar que `DeactivateUser` escriba la auditoría al final y decidir la agrupación de negaciones repetidas (ADR 0022) | Código ⚠ | Ing. | M | B1 | |

## H · Infraestructura base

**Nivel** 2 · **Requiere:** A, C · **En paralelo con:** F, G, I · **Zona:** worker, CI y documentos operativos

| ID | Tarea | Tipo | Decide | Tam. | Depende de | Quién |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] H1 | Punto de entrada del worker (no existe) [V]: purga de versiones a los 30 días y aviso de 24 h de un segundo factor pendiente | Código | Equipo | M | C1 | |
| [ ] H2 | Primera ejecución del CI en GitHub, corregir lo que falle y añadir los escáneres de seguridad. El dueño lo despriorizó; la puerta de producción lo vuelve necesario. Subir al remoto es decisión del equipo | Código | Equipo | S | A8 | |
| [ ] H3 | Guía de `trustProxy`: detrás de un balanceador todos comparten la IP; mal activado, se falsifica [S] | Doc | Ing. | S | A6 | |

## I · Bóveda: cuentas

**Nivel** 2 · **Requiere:** B · **En paralelo con:** F, G, H · **Zona:** módulos de acceso y bóveda ⚠

| ID | Tarea | Tipo | Decide | Tam. | Depende de | Quién |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] I1 | Criterios de aceptación medibles para las subtareas de la bóveda en `odd/tasks/phase-1b-vault.md` (I2, K1, K2, M1, M2, N1 a N3, O1, O2): rendimiento del listado por acceso efectivo, qué ve quien tiene `inventory`, efecto de archivar una cuenta, duración y desbloqueo tras superar el límite de revelaciones. Añadir el ADR 0023 como prerrequisito | Doc | Equipo | S | B1, B2, B5 | |
| [ ] I2 | **B1 del plan:** acceso efectivo y cuentas. Catálogo de plataformas (lectura), crear, editar y archivar cuentas, listado filtrado por acceso efectivo y pantalla de cuentas | Código ⚠ | — | M | I1, B1, B5, B11 | |

---

# NIVEL 3 · Cimientos

Dependen de los niveles 1 y 2. J, K y L son independientes entre sí.

## J · Cierre de identidad (parte 2) y documentación

**Nivel** 3 · **Requiere:** B, C, F, G · **En paralelo con:** K, L · **Zona:** módulo de identidad y documentos

| ID | Tarea | Tipo | Decide | Tam. | Depende de | Quién |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] J1 | Límites de intentos: implementar Redis o, si F3 declara instancia única, un guardarraíl de arranque que lo haga cumplir y lo documente. Hoy viven en memoria por instancia y un reinicio borra los bloqueos [V] | Código ⚠ | Ing. | M | F3 | |
| [ ] J2 | Exigir passkeys como configuración de la organización (incluye la pantalla de configuración) | Código ⚠ | Dueño | M | F7 | |
| [ ] J3 | Transferencia de la Raíz: hoy no pertenece a ninguna fase (`transfer-root.md` la ubica en 1c y los criterios de 1c no la incluyen) [V]. Asignarla a 1c e implementarla | Código ⚠ | Dueño | M | G2 | |
| [ ] J4 | `plan.md`: passkeys obligatorias a Raíz y Administradores (`:471`, `:1042`) y "con passkey la reautenticación es un toque" (`:484`), contra el ADR 0028; y "20 ADR iniciales" (`:834`), cuando ya hay 30 | Doc | Ing. | S | B6, F7 | |
| [ ] J5 | `docs/business/authentication.md` llama "preferida" a la passkey y describe el restablecimiento "por el responsable" como si existiera; `roadmap-and-status.md` marca "Cumplido" el segundo factor obligatorio con solo TOTP | Doc | Ing. | S | C3, F7 | |
| [ ] J6 | Cierre formal de la fase 1a: hoy los documentos la describen de tres maneras ("funcionalmente completa", "en lo esencial", "aún no se sabe") | Decisión | Dueño | S | G1, G2, G3, G4, J1 | |

## K · Bóveda: credenciales y compartición

**Nivel** 3 · **Requiere:** B, I · **En paralelo con:** J, L · **Zona:** módulo de bóveda ⚠

K1 y K2 son independientes entre sí. Comparten la zona de la bóveda: avisa en "Quién" para no chocar en la misma migración.

| ID | Tarea | Tipo | Decide | Tam. | Depende de | Quién |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] K1 | **B2 del plan, parte a:** credenciales. Crear, cambiar contraseña con versiones y huella, historial sin contenido, copiar usuario | Código ⚠ | — | M | I2, B4, B10 | |
| [ ] K2 | **B3 del plan:** compartición y grupos. Por persona y por grupo, caducidad, no compartir más de lo propio. Incluye dónde vive la tarea de rotación al revocar mientras no exista P1 | Código ⚠ | — | M | I2, B10, B11 | |

## L · Operación: KMS y runbooks

**Nivel** 3 · **Requiere:** C, D, F, G · **En paralelo con:** J, K · **Zona:** criptografía y KMS ⚠, runbooks

| ID | Tarea | Tipo | Decide | Tam. | Depende de | Quién |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] L1 | Adaptador de KMS de producción (el local se niega a arrancar con `NODE_ENV=production`, así que la API hoy no arranca así) [V] | Código ⚠ | — | L | C1, F5, D1 | |
| [ ] L2 | Definir los comandos "por definir" de los runbooks: rotar DEK, restaurar respaldo, fuga de base de datos, usuario o servidor comprometido, transferir la Raíz | Ops | Ing. | M | F4 | |
| [ ] L3 | Runbooks que faltan: caída total con sobres sellados, pérdida o borrado de la KEK, restauración con el KMS, y regeneración de la contraseña inicial extraviada de la Raíz | Ops | Ing. | M | C11, G2 | |

---

# NIVEL 4 · Bóveda y operación en paralelo

Dependen de los niveles anteriores. M, N, O, P y Q son independientes entre sí: cinco personas pueden trabajar a la vez, una por letra.

## M · Revelar y restaurar credenciales

**Nivel** 4 · **Requiere:** B, K · **En paralelo con:** N, O, P, Q · **Zona:** bóveda, revelación de secretos ⚠

| ID | Tarea | Tipo | Decide | Tam. | Depende de | Quién |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] M1 | **B2 del plan, parte b:** revelar contraseña. Reautenticación, motivo, límite por hora, alerta al superarlo y ocultado a los 30 s | Código ⚠ | — | M | K1, K2, B2, B3, B6 | |
| [ ] M2 | Restaurar una versión de la credencial (BO-7). Hoy no está asignada a ninguna porción del plan [V] | Código ⚠ | — | S | K1 | |

## N · Segundo factor

**Nivel** 4 · **Requiere:** B, K · **En paralelo con:** M, O, P, Q · **Zona:** bóveda, criptografía y segundo factor ⚠

Las tres se hacen en orden: N2 depende de N1 y N3 de N2.

| ID | Tarea | Tipo | Decide | Tam. | Depende de | Quién |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] N1 | **B4 del plan, parte a:** segundo factor en el servidor. Registro (validación, confirmación, pendiente 24 h), código bajo demanda, exportar, re-registrar y retirar; registro por clave manual | Código ⚠ | — | L | K1, B8, B9 | |
| [ ] N2 | **B4 del plan, parte b:** registro del segundo factor por imagen del QR | Código ⚠ | — | M | N1, B7 | |
| [ ] N3 | **B5 del plan:** captura de pestaña, importación de Google Authenticator y entrega por celular (según el recorte de B8) | Código ⚠ | — | M | N2, B8 | |

## O · Búsqueda e importación

**Nivel** 4 · **Requiere:** B, K · **En paralelo con:** M, N, P, Q · **Zona:** bóveda, búsqueda

| ID | Tarea | Tipo | Decide | Tam. | Depende de | Quién |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] O1 | **B6 del plan:** búsqueda avanzada, índice ciego por usuario y vistas guardadas | Código ⚠ | — | M | K1, B4 | |
| [ ] O2 | **B7 del plan:** importación por CSV | Código | — | S | K1 | |

## P · Gobernanza base

**Nivel** 4 · **Requiere:** B, K · **En paralelo con:** M, N, O, Q · **Zona:** gobernanza

| ID | Tarea | Tipo | Decide | Tam. | Depende de | Quién |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] P1 | Bajas con tareas de rotación de secretos. Decidir qué pasa si la persona dada de baja era la única gestora de una cuenta (sin asignatario) | Código ⚠ | Dueño | L | K2, B10 | |
| [ ] P2 | Salud de credenciales | Código | — | M | K1 | |
| [ ] P3 | Acceso temporal (JIT) | Código ⚠ | — | M | K2 | |

## Q · Ensayos de operación

**Nivel** 4 · **Requiere:** L · **En paralelo con:** M, N, O, P · **Zona:** runbooks y operación

| ID | Tarea | Tipo | Decide | Tam. | Depende de | Quién |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] Q1 | Ensayar todos los runbooks (hoy los 9 están como borrador "sin ensayar") [V] | Ops | Equipo | M | L2, L3 | |
| [ ] Q2 | Simulacro de restauración completo, incluida la apertura de secretos con las claves | Ops | Equipo | M | L1, L2 | |

---

# NIVEL 5 · Cierre de gobernanza

## R · Auditoría y alertas críticas

**Nivel** 5 · **Requiere:** B, F, G, M · **Zona:** auditoría y notificación ⚠

R1 y R2 son independientes entre sí.

| ID | Tarea | Tipo | Decide | Tam. | Depende de | Quién |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] R1 | Auditoría con pantalla y verificación de la cadena | Código ⚠ | — | L | F2, M1 | |
| [ ] R2 | Alertas críticas, incluida la de superar el límite de revelaciones | Código ⚠ | — | M | G5, B2, M1 | |

---

# NIVEL 6 · Puerta de producción

**Hasta cerrar todo lo anterior y pasar la prueba de intrusión: no cargar ninguna credencial real.**

## S · Prueba de intrusión y producción

**Nivel** 6 · **Requiere:** todas las épicas anteriores (A a R) · **Zona:** operación

| ID | Tarea | Tipo | Decide | Tam. | Depende de | Quién |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] S1 | Prueba de intrusión externa sin hallazgos altos o críticos abiertos | Ops | Dueño | L | todas las épicas A a R, C7 | |
| [ ] S2 | Reevaluar las fases 3 (SAML con Meta), 4 (correo con DKIM y cuarentena) y 7 (broker, que el plan llama frágil): son productos aparte. No comprometer diseño ni estimaciones antes de S1 [S] | Decisión | Dueño | S | S1 | |

---

## Camino crítico

La cadena más larga, la que fija el ritmo total, es la de la bóveda: **B → I → K → M → R → S**. Todo lo demás puede avanzar en paralelo sin retrasarla.

1. **Hoy, en paralelo (nivel 1):** A, B, C, D y E. Cinco personas pueden empezar a la vez.
2. **Apenas cierren B y C:** F, G, H e I. En particular I (cuentas) abre la bóveda.
3. **Con I y B cerradas:** K, y en paralelo J y L.
4. **Con K cerrada:** M, N, O y P a la vez. Con L cerrada, Q.
5. **Cierre:** R, luego S. Solo entonces, credenciales reales.

## Qué NO se verificó en esta revisión

- Que formato, compilación, tipos, lint y pruebas pasen hoy (A1).
- Las zonas listadas en A2 a A6.
- Las suposiciones marcadas [S]: son hipótesis a confirmar, no defectos probados.
- Los tamaños y el orden de las subtareas de la bóveda: son criterio de esta revisión, no del equipo.
