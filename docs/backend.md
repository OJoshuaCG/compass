# Guía de backend

Reglas de arquitectura, código y operación de `apps/api` (NestJS + TypeScript). Complementa a `plan.md`: si algo aquí contradice al plan en seguridad, manda el plan. El contrato con el frontend (paginación, errores, idempotencia) está alineado con `docs/frontend.md`.

## 1. Principios

1. **El dominio no conoce el framework.** NestJS, Drizzle, Redis y el KMS son detalles reemplazables.
2. **Una sola puerta por responsabilidad.** Autorizar: `Authorizer`. Cifrar: `SecretCipher`. Auditar: `AuditLog`. Nadie reimplementa esos pasos.
3. **Falla cerrada.** Sin contexto de organización, sin permiso, sin auditoría o sin KMS, la acción no ocurre.
4. **Lo que no tiene lint o prueba, se rompe.** Cada regla de esta guía indica cómo se verifica.
5. **Los secretos nunca salen de `crypto`.** No se registran, no se serializan, no se devuelven fuera de la acción que los revela.
6. **Entradas no confiables en los bordes.** Todo dato externo se valida con Zod antes de entrar a la aplicación.

## 2. Stack

La lista aprobada está en el plan (sección "Stack tecnológico y bibliotecas aprobadas"): Node.js LTS, TypeScript `strict`, NestJS con Fastify, PostgreSQL 16+, Drizzle, BullMQ + Redis, Zod, `jose`, `@node-rs/argon2`, `@simplewebauthn/server`, `otplib`, `pino`, OpenTelemetry.

> **Estado de dependencias (fase 0):** instaladas con versión exacta y publicadas hace más de 7 días (`minimumReleaseAge` de pnpm): `uuidv7`, `unplugin-swc` + `@swc/core` (Vitest necesita emitir metadatos de decoradores para los controladores de Nest), `dependency-cruiser`, `fastify` y `@fastify/helmet`. **Sigue pendiente** un generador de OpenAPI desde Zod (por ejemplo `@asteasolutions/zod-to-openapi`). Para `Result`, el pipe de validación Zod y la configuración de entorno se escribió código propio pequeño.
>
> **Versiones relevantes:** TypeScript **6.0.3** (no 7: `typescript-eslint` 8.72 solo admite `<6.1.0`) y NestJS 12, que es **solo ESM**; por eso todo el monorepo es ESM (`module: NodeNext`, imports relativos con extensión `.js`).

## 3. Arquitectura

### 3.1 Decisión: hexagonal por módulo, sí

El plan ya la fija (ADR 001) y conviene mantenerla en el backend por tres razones concretas de este producto:

- **Hay reglas de seguridad que deben ser TS puro y 100 % probables** (matriz de jerarquía, motor de decisión, versiones de secretos). Aislarlas del framework permite pruebas unitarias exhaustivas y mutación (Stryker) sin levantar Nest ni base de datos.
- **Los adaptadores sí cambiarán**: KMS local / AWS (y quizá GCP o Azure, ADR 020), correo, SMS, Redis.
- **El monolito se podrá partir** (ADR 001) porque los módulos solo se hablan por fachadas y eventos.

Matices para que no se vuelva ceremonia:

- **CQRS ligero** (plan): los *comandos* pasan por el dominio; las *consultas* de listado leen proyecciones SQL directas, siempre con el filtro de acceso.
- **Un puerto existe cuando hay una razón real** (infraestructura externa o algo que se simula en pruebas). No se crean interfaces para clases internas con una sola implementación.
- Los módulos "futuros" (`federation`, `inbound-codes`, `broker`) nacen como carpetas con puertos y sin adaptadores, como indica el plan.

### 3.2 Capas y regla de dependencia

| Capa | Contiene | Puede importar |
| --- | --- | --- |
| `domain` | Entidades, objetos de valor, políticas, eventos, errores | Solo `domain` del módulo y `shared/kernel`. **Sin** NestJS, Drizzle ni Node |
| `application` | Casos de uso, puertos, DTO internos | `domain` del módulo, fachadas públicas de otros módulos y `shared/kernel`. **Sin** decoradores de Nest |
| `infrastructure` | Repositorios Drizzle, KMS, Redis, correo | `application`, `domain`, bibliotecas externas |
| `interface` | Controladores, SSE, procesadores de cola, mapeo a contratos | `application` del módulo y `packages/contracts` |
| `<modulo>.module.ts` | **Raíz de composición**: une puertos con adaptadores | Todas las capas del módulo |

- Verificación en `apps/api`: reglas `no-restricted-imports` por capa en `eslint.config.js` (domain/application sin Nest, Drizzle ni `node:*`; `node:crypto` solo en `modules/crypto`) y `dependency-cruiser` (`.dependency-cruiser.cjs`) para la regla entre módulos (solo por `index.ts`) y los ciclos. `eslint-plugin-boundaries` se usa en `apps/web`. Ambas comprobaciones corren con `pnpm lint`.
- **Entre módulos**: solo por `index.ts` (fachada) o por eventos de dominio vía outbox. Ningún módulo lee tablas ni repositorios de otro.
- **`node:crypto` solo en `modules/crypto`** (lint `no-restricted-imports`).

> **Extensión al plan:** el plan no nombra `*.module.ts`. Se añade como archivo en la raíz de cada módulo porque es el único sitio donde el cableado de DI puede conocer todas las capas sin romper la regla de dependencia.

### 3.3 Estructura de un módulo

```
modules/vault/
├─ domain/
│  ├─ account.ts            # entidad / agregado
│  ├─ credential.ts
│  ├─ share-level.ts        # objeto de valor (USE < VIEW < EDIT < MANAGE)
│  ├─ errors.ts             # DomainError con códigos estables
│  └─ events.ts             # eventos de dominio
├─ application/
│  ├─ reveal-password.ts    # un caso de uso = una clase = un archivo
│  ├─ ports/
│  │  ├─ account-repository.ts
│  │  └─ secret-store.ts
│  └─ dto.ts
├─ infrastructure/
│  ├─ drizzle-account-repository.ts
│  └─ schema.ts             # tablas Drizzle del módulo
├─ interface/
│  ├─ vault.controller.ts
│  └─ vault.mapper.ts       # dominio → contrato
├─ vault.module.ts          # raíz de composición
├─ index.ts                 # fachada pública
├─ README.md
└─ CLAUDE.md                # solo en módulos protegidos
```

### 3.4 `shared/kernel`

Lo único compartido por todos los módulos. Mantenerlo mínimo y sin lógica de negocio:

- `Result<T, E>`, `ok()`, `err()` (implementación propia, pequeña).
- `DomainError` base (código estable, mensaje, metadatos seguros).
- Tipos de marca: `UserId`, `OrganizationId`, `CredentialId`…
- Puertos transversales: `Clock`, `IdGenerator` (UUIDv7), `RequestContext` (lectura).

Si una pieza de `shared/kernel` empieza a conocer un concepto de un módulo, pertenece a ese módulo.

### 3.5 Comunicación entre módulos

- **Síncrona**: `vault` llama a `access.Authorizer` y a `crypto.SecretCipher` mediante sus fachadas. La fachada exporta **interfaces y casos de uso**, nunca entidades ni repositorios.
- **Asíncrona**: eventos de dominio en `outbox_events`, escritos en la misma transacción y publicados por el worker. Los consumidores son idempotentes (un evento puede llegar dos veces).
- **Prohibido**: importar repositorios, entidades o tablas de otro módulo.

## 4. Dominio

- **TS puro**, sin `Date.now()` ni `Math.random()` directos: el tiempo y los ids llegan por `Clock` e `IdGenerator`, para que las pruebas sean deterministas.
- **Agregados pequeños**, con invariantes en el constructor o en métodos de fábrica; no hay entidades "anémicas" que cualquiera mute desde fuera.
- **Objetos de valor inmutables** (`ShareLevel`, `Rank`, `Email`, `TotpUri`) que validan al crearse.
- **Tipos de marca** para todo identificador. Un `UserId` no es un `CredentialId`.
- **Errores esperados como `Result<T, DomainError>`**; las excepciones se reservan para lo inesperado (bug, caída). Cada `DomainError` lleva un `code` estable (`AUTHZ.HIERARCHY.NOT_IN_SUBTREE`), clave de traducción en la UI y entrada de un catálogo versionado.
- **Políticas como funciones puras**: `puedeGestionar(actor, objetivo)`, matriz de creación y no escalamiento viven en `domain` y se prueban con tablas.
- Los eventos de dominio son datos inmutables, sin referencias a infraestructura.

## 5. Aplicación

### 5.1 Casos de uso

- Una clase, un método `execute`, un archivo, un nombre en imperativo (`RevealPassword`, `ShareAccount`, `DeactivateUser`).
- **Sin decoradores de Nest**: es una clase TS normal con sus dependencias por constructor. El cableado lo hace `*.module.ts` con `useFactory`.
- Devuelve `Result<T, DomainError>`; no lanza excepciones por reglas de negocio.
- No recibe `organizationId` como argumento libre: lo lee del `RequestContext`.

```ts
export class RevealPassword {
  constructor(private readonly deps: {
    authorizer: Authorizer;
    accounts: AccountRepository;
    secrets: SecretReader;
    audit: AuditLog;
    uow: UnitOfWork;
  }) {}

  async execute(cmd: RevealPasswordCommand): Promise<Result<RevealedSecret, DomainError>> {
    return this.deps.uow.run(async () => {
      const decision = await this.deps.authorizer.authorize(
        'credential.reveal_password',
        { type: 'credential', id: cmd.credentialId },
      );
      if (!decision.allowed) return err(decision.toError());
      // … leer secreto con propósito REVEAL, auditar, devolver
    });
  }
}
```

### 5.2 Flujo obligatorio de un caso de uso sensible

1. Abrir la transacción (`UnitOfWork.run`), que fija `SET LOCAL app.org_id`.
2. Llamar a `Authorizer.authorize()` (motor completo de 7 pasos del plan). El guard del controlador es una red de seguridad, **no** la autorización.
3. Ejecutar la lógica de dominio.
4. Escribir la auditoría con `AuditLog.record()` **en la misma transacción**. La secuencia (`seq`), `prev_hash`, `hash` y `created_at` los asigna un trigger de la base de datos con un advisory lock por organización: la aplicación nunca calcula el hash. La verificación es `audit_verify_chain()`.
5. Escribir eventos en `outbox_events` en la misma transacción.
6. Cerrar la transacción. Si la auditoría falla, la acción falla.

### 5.3 Puertos

- Interfaces TS en `application/ports/`, nombradas por intención (`AccountRepository`, `KeyManagementPort`), con TSDoc obligatorio.
- Tokens de inyección: `Symbol` exportado junto a la interfaz (`ACCOUNT_REPOSITORY`).
- Los repositorios devuelven entidades de dominio, no filas ni tipos de Drizzle.

### 5.4 Consultas (lectura)

- Pueden usar proyecciones SQL directas, **siempre** unidas a la vista `effective_access`. Prohibido cargar registros para filtrarlos en memoria.
- Cada consulta de listado declara su lista blanca de filtros y de campos ordenables (solo indexados).
- Paginación por cursor (sección 7.4).

## 6. Infraestructura

### 6.1 Base de datos (Drizzle + PostgreSQL)

- Esquemas Drizzle **por módulo** (`infrastructure/schema.ts`); ningún módulo importa el esquema de otro.
- Migraciones SQL versionadas en `db/migrations`, con RLS por tabla. **Nunca se edita una migración aplicada**: se crea otra.
- **Una tabla nueva** incluye en la misma migración `organization_id`, índice compuesto que empieza por él y política RLS. Una prueba de CI lo verifica.
- Patrón *expandir y contraer*: primero se agrega, luego se retira lo viejo en otra migración.
- Dos roles: **aplicación** (sin `BYPASSRLS`, no dueño de tablas; en `audit_events` solo `INSERT`/`SELECT`) y **migraciones**.
- Bajas lógicas; nada del dominio se borra físicamente salvo datos efímeros con TTL.
- Concurrencia optimista con `version int` y `If-Match` en `PATCH`.

### 6.2 Transacciones y RLS

- `UnitOfWork.run(fn)` abre la transacción, ejecuta `SET LOCAL app.org_id = '<uuid>'` y publica la transacción actual en un `AsyncLocalStorage`; los repositorios la toman de ahí. **No hay acceso a la base de datos fuera de una transacción con contexto.**
- El `organizationId` sale del `RequestContext` (sesión autenticada), nunca de un parámetro que envía el cliente.
- Una prueba de integración con **dos organizaciones** verifica, por repositorio, que A nunca lee, modifica ni cuenta filas de B. Corre en cada PR.

### 6.3 Otros adaptadores

- **KMS**: `KeyManagementPort` con adaptadores AWS y `LocalKeyManagement`. Este último **se niega a arrancar** si `NODE_ENV=production`. En pruebas, un adaptador falso determinista.
- **Redis**: contadores, límites y colas. **Nunca** material criptográfico.
- **Correo/SMS**: detrás de puertos; el proveedor concreto es intercambiable.
- **Outbox**: el worker publica y marca `published_at`; reintentos con *backoff*.

## 7. Interfaz HTTP (NestJS)

### 7.1 Controladores

- **Delgados**: validan la entrada, llaman a **un** caso de uso y mapean el resultado a un contrato. Sin lógica de negocio.
- Validación con un `ZodValidationPipe` propio sobre los esquemas de `packages/contracts`. Prohibido `class-validator`.
- El guard de permisos aplica el paso 3 como red de seguridad, no como autorización completa.
- Nunca se devuelven entidades de dominio: siempre un mapper al contrato.

### 7.2 Proveedores globales

Registrados una sola vez en el módulo raíz, en este orden de responsabilidad:

1. Middleware de `X-Request-Id` y creación del `RequestContext` (`AsyncLocalStorage`).
2. Guard de sesión (cookie `__Host-session`), protección CSRF (`X-Requested-With` + verificación de `Origin`).
3. Guard de permisos.
4. Interceptor de idempotencia (`Idempotency-Key`, respuesta guardada 24 h) para los `POST` que crean recursos.
5. Filtro global de excepciones: traduce `DomainError` y errores conocidos a **Problem Details (RFC 9457)**; cualquier otra excepción responde un `500` genérico con `requestId`, sin detalles internos.

### 7.3 Errores

```json
{
  "type": "https://errors.internal/authz/hierarchy",
  "title": "Not allowed to manage this user",
  "status": 403,
  "code": "AUTHZ.HIERARCHY.NOT_IN_SUBTREE",
  "requestId": "01J…"
}
```

- `code` estable y documentado en el catálogo; es la clave de traducción de la UI.
- Nunca se filtra SQL, rutas ni trazas.
- `404` en lugar de `403` cuando el usuario no debe saber que el recurso existe.
- Validación: `422` con la lista de campos inválidos.
- Conflicto de versión: `409`. Reautenticación requerida: `403` con código específico que la UI reconoce para abrir el diálogo.

### 7.4 Convenciones de la API

- REST bajo `/api/v1`, recursos en plural y en inglés; acciones no CRUD como sub-recurso con verbo (`POST /credentials/:id/reveal`).
- **Paginación por cursor**, alineada con `DataTable` del frontend:
  - Petición: `?cursor=&limit=&sort=&dir=`. `limit` máximo **100** (valores del frontend: 10, 25, 50, 100); por defecto 25.
  - Respuesta: `{ "data": [...], "page": { "nextCursor": "…" | null, "limit": 25, "total"?: number } }`.
  - El cliente guarda la pila de cursores para retroceder; la API **no** necesita un cursor "anterior". `total` es opcional y solo si el endpoint lo calcula de forma barata.
  - El cursor es opaco, firmado y de corta vida.
- `sort` solo por campos indexados y de lista blanca; un campo no permitido responde `422`.
- Fechas ISO 8601 UTC. `X-Request-Id` en cada respuesta.
- Eventos en tiempo real por SSE (`/api/v1/events`).
- Contratos Zod en `packages/contracts` y OpenAPI generado de ellos. Un cambio incompatible crea `v2` del recurso afectado.

### 7.5 Respuestas con secretos

Solo la acción dedicada (revelar, código 2FA, exportar) devuelve un secreto, con `Cache-Control: no-store`. Nunca aparece en listados ni en detalles.

## 8. Buenas prácticas de NestJS

- **Dos puntos de entrada, una imagen**: `main.http.ts`, `main.worker.ts` y `main.migrate.ts` (comandos de arranque distintos).
- **Fastify** como adaptador. Los plugins de Fastify (`@fastify/helmet`, cookies) se registran en `main.http.ts`, no en módulos de dominio.
- **Módulos por funcionalidad**: un `*.module.ts` por módulo de dominio; solo exporta lo que la fachada declara.
- **Inyección por constructor**, con tokens (`Symbol`) para puertos. Prohibida la inyección por propiedad y el uso de `ModuleRef.get` para obtener dependencias "al vuelo".
- **Sin referencias circulares**: `forwardRef` es señal de que dos módulos están mal separados; se resuelve con un evento o moviendo la responsabilidad.
- **Configuración**: variables de entorno validadas al arrancar con un esquema Zod propio; el servicio no arranca con configuración inválida. Los secretos de infraestructura vienen del gestor de secretos, nunca de `.env` ni del repositorio.
- **Ciclo de vida**: `OnApplicationShutdown` y *graceful shutdown* (drenar peticiones, cerrar pool y colas). *Health checks* separados de *liveness* y *readiness*.
- **Workers**: los procesadores de BullMQ viven en `interface/` del módulo, delegan en un caso de uso y son idempotentes, con reintentos y *backoff* acotados.
- **Decoradores de Nest solo en `interface/` y `*.module.ts`.** Si aparecen en `domain` o `application`, el lint falla.
- **Sin estado global mutable** en servicios; la caché de DEK es la única excepción y vive en `crypto` (con TTL y límite de usos, ver plan).

## 9. TypeScript

- `tsconfig` base en `packages/config`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `useUnknownInCatchVariables`, `noImplicitReturns`, `noFallthroughCasesInSwitch`.
- Prohibido `any` (lint como error). `unknown` y validación con Zod en los bordes.
- Tipos de marca para identificadores; uniones discriminadas para estados (`status`) y resultados.
- `satisfies` para configuraciones tipadas; `as const` para catálogos (permisos, códigos de error).
- Sin `enum` de TypeScript para datos que viajan por la red: se usan uniones de literales o `as const` (el catálogo de permisos del plan es un `enum` versionado en código; se mantiene así por decisión del plan y se genera su unión de tipos).
- Prohibidos los *barrel files* internos (`index.ts` de carpetas intermedias); solo la fachada del módulo exporta.
- `import type` para tipos; ciclos de importación prohibidos (dependency-cruiser).
- Nombres en inglés en el código; comentarios y documentación en español. Los comentarios explican **por qué**, no qué.

## 10. Seguridad (invariantes)

Todo archivo de los módulos protegidos (`identity`, `access`, `crypto`, `audit`) abre con este bloque:

```ts
/**
 * Invariantes de seguridad
 * - <lo que nunca debe romperse en este archivo>
 * - …
 */
```

Reglas que aplican a todo el backend:

- **Nunca** registrar secretos, tokens, cookies ni cuerpos de rutas sensibles (revelación, códigos, handoff).
- **Todo acceso a un secreto declara su `SecretAccessPurpose`** (`REVEAL | TOTP_CODE | EXPORT | INJECT`); se autoriza y audita por propósito. `INJECT` está deshabilitado.
- **Tokens** (sesión, invitación, handoff): 256 bits aleatorios; en base de datos solo su SHA-256.
- **Contraseñas**: Argon2id (`@node-rs/argon2`); nunca cifradas ni registradas.
- **Comparaciones de secretos y hashes** en tiempo constante.
- **JWT con `jose`**: lista blanca de algoritmos; nunca se confía en el `alg` del token.
- **Cifrado**: AES-256-GCM, nonce aleatorio de 12 bytes por operación, AAD `org_id | credential_id | field | version`. Solo `SecretCipher`.
- **Rate limiting** por usuario, IP y acción (`rate-limiter-flexible` sobre Redis); mensajes idénticos para usuario inexistente o contraseña incorrecta.
- **Auditoría**: append-only, encadenada por hash; sin secretos, ni parciales; `metadata` con lista blanca de campos.
- El correo entrante (fase 4) y los datos externos son **entrada no confiable**: nunca se renderiza HTML, se ignoran adjuntos y hay límites de tamaño y tiempo.

## 11. Observabilidad y logs

- `pino` en JSON con `requestId`, `organizationId`, `actorId`, módulo y caso de uso, tomados del `RequestContext`.
- Redacción por configuración: `password`, `secret`, `token`, `totp`, `code`, `authorization`, `cookie`, `ciphertext`, `wrapped_dek` y cuerpos de las rutas sensibles.
- Una prueba envía secretos conocidos por los endpoints sensibles y verifica que no aparecen en los logs capturados.
- Logs técnicos y auditoría son cosas distintas: los logs se muestrean; la auditoría es evidencia y nunca se pierde.
- OpenTelemetry: trazas y métricas de negocio y seguridad (revelaciones, códigos 2FA, llamadas al KMS, aciertos de caché de DEK, negaciones por código).

## 12. Pruebas

| Tipo | Herramienta | Qué cubre |
| --- | --- | --- |
| Unitarias de dominio | Vitest | Políticas, entidades, objetos de valor. 90 % de ramas en módulos protegidos |
| Matriz de autorización | Vitest, tabla generada | Cada actor × rango × relación × acción. 100 % de combinaciones |
| Mutación | Stryker | `access` y `crypto` (mínimo 80 %) |
| Integración | Vitest + Testcontainers | Repositorios, RLS, transacciones, auditoría, colas (PostgreSQL y Redis reales) |
| Aislamiento de tenants | Testcontainers | Dos organizaciones; ningún cruce |
| Contrato | Zod + OpenAPI | La API cumple su contrato |
| Arquitectura | `eslint-plugin-boundaries`, dependency-cruiser | Regla de dependencia |
| Seguridad | Semgrep, gitleaks, osv-scanner, Trivy | SAST, secretos, dependencias, imágenes |

- **Casos de uso**: se prueban con puertos falsos en memoria (sin Nest ni base de datos). Los repositorios se prueban con PostgreSQL real.
- **Controladores**: pruebas de integración HTTP con Fastify `inject`, contra una base de datos real.
- **Reloj e ids deterministas** (`Clock` e `IdGenerator` falsos).
- **Criptografía**: vectores conocidos (AES-GCM, RFC 6238 para TOTP) y pruebas negativas (AAD alterado, nonce reutilizado, DEK incorrecta, texto truncado).
- **Auditoría**: cada caso de uso sensible verifica el evento exacto que escribe; prueba de falla cerrada; cadena de hashes verificada tras operaciones concurrentes.
- **Matriz de autorización**: la escribe o la revisa una persona como código de producción (ver sección 14).
- Las pruebas de integración usan contenedores efímeros; ningún dato real fuera de producción.
- Vitest se divide en dos proyectos: `unit` (`pnpm --filter @iam/api test:unit`, sin contenedores) e `integration` (`test:integration`, un PostgreSQL 17 por ejecución y una base por archivo, migrada con `@iam/db` como `iam_migrator` y usada como `iam_app`). Con Podman: `DOCKER_HOST=unix:///run/user/$(id -u)/podman/podman.sock TESTCONTAINERS_RYUK_DISABLED=true`; `turbo.json` declara esas variables en `globalPassThroughEnv`.

## 13. Flujo de trabajo

- Trunk-based con ramas de vida corta; Conventional Commits; PR pequeños. Plantilla de PR con lista de seguridad (autorización, auditoría, secretos en logs, filtro de organización, pruebas de matriz).
- Toda PR requiere revisión humana; las que tocan rutas protegidas requieren dos.
- `CODEOWNERS`: `modules/identity`, `modules/access`, `modules/crypto`, `modules/audit`, migraciones con RLS, configuración de CSP y cabeceras.
- Cada módulo tiene `README.md` (responsabilidad, fachada pública, eventos que emite y consume); los módulos protegidos, además, un `CLAUDE.md`.
- Cada decisión de arquitectura nueva se registra como ADR en `docs/adr/`.
- Dependencias: versiones exactas, lockfile, `pnpm install --frozen-lockfile` en CI, espera de 7 días tras cada publicación, `ignore-scripts` con lista blanca.

## 14. Trabajo con agentes

Se puede apoyar el desarrollo del backend en los agentes de Claude Code disponibles a nivel global. Son una ayuda para ejecutar: **todo lo que produzcan debe cumplir esta guía y pasar revisión humana**.

### Agentes y para qué sirven

| Agente | Úsalo para | Límites |
| --- | --- | --- |
| `general-purpose` | Implementar un caso de uso, repositorio o controlador con sus pruebas, cuando el alcance está acotado | Escribe código; necesita rutas permitidas explícitas |
| `typescript-pro` | Tipos de marca, genéricos de `Result`, tipos derivados de `contracts`, utilidades tipadas | Solo tipos y utilidades; no decide arquitectura |
| `Explore` | Mapear dónde vive algo o cómo fluye una petición, sin tocar nada | Solo lectura |
| `Plan` | Diseñar la implementación de una funcionalidad antes de escribirla | No escribe archivos |
| `review-risk` | Revisar seguridad, permisos, exposición de datos y dependencias | Revisión; no corrige |
| `review-resilience` | Revisar reintentos, fallas parciales, transacciones, concurrencia | Revisión; no corrige |
| `review-reliability` | Revisar valor y determinismo de las pruebas, bordes y regresiones | Revisión; no corrige |
| `review-readability` | Revisar nombres, complejidad y tamaño del cambio | Revisión; no corrige |
| `git` | Commits granulares con Conventional Commits | Pide confirmar el alcance antes de `git add` |

No hay un agente específico de backend: la implementación la hace `general-purpose` con un encargo preciso. La revisión (`review-*`) es independiente de quien escribió el código.

### Cómo delegar

1. **Apunta a la guía por referencia**: "lee `docs/backend.md` y `plan.md` (secciones X e Y) antes de escribir". No se parafrasean las reglas.
2. **Alcance explícito de archivos**: rutas que puede crear o editar (por ejemplo, `apps/api/src/modules/vault/application/reveal-password.ts` y su prueba). Nada fuera de ellas.
3. **Una unidad de comportamiento por encargo**: caso de uso + puertos + pruebas juntos; no se parte el mismo comportamiento entre agentes.
4. **Reutilizar antes de crear**: nombrar los helpers existentes (`Authorizer`, `AuditLog`, `UnitOfWork`, `SecretCipher`, `Result`) y los invariantes que deben mantener.
5. **Criterios de aceptación y comando de verificación** en el encargo (sección 15).
6. El agente informa qué archivos tocó, qué comprobó y qué no pudo comprobar.

### Lo que los agentes no hacen

- **No agregan dependencias**: proponen y se detienen.
- **No escriben en módulos protegidos** (`identity`, `access`, `crypto`, `audit`), migraciones con RLS ni configuración de CSP/cabeceras, salvo encargo humano explícito. Sí pueden **revisarlos**.
- **No editan migraciones ya aplicadas.**
- **No leen `.env*`** ni datos de producción; no ejecutan comandos de red ni de despliegue.
- **No escriben las pruebas de la matriz de autorización** ni las de criptografía y aislamiento de tenants sin revisión humana línea por línea: si quien escribe el código escribe también la prueba, puede codificar el mismo error en ambos.
- **No marcan como terminado** lo que no comprobaron.

### Revisión

- En rutas protegidas se revisa línea por línea con dos personas; "las pruebas pasan" no basta.
- Tras un cambio sensible (autorización, criptografía, auditoría, transacciones), se usan los revisores `review-*` pertinentes como segunda opinión independiente y sus hallazgos se triagean antes de actuar.

## 15. Definición de terminado (backend)

- [ ] Respeta las capas y la fachada del módulo; lint de límites en verde.
- [ ] Caso de uso sensible: pasa por `Authorizer`, audita en la misma transacción y emite eventos por outbox.
- [ ] Toda consulta pasa por repositorios con contexto de organización; sin SQL fuera de RLS.
- [ ] Entradas validadas con Zod; errores como `DomainError` con `code` en el catálogo.
- [ ] Sin secretos en logs, respuestas ni errores.
- [ ] Pruebas: unitarias de dominio; integración con PostgreSQL real si toca repositorios; matriz si toca autorización; aislamiento de tenants si añade tablas o listados.
- [ ] Tabla nueva: `organization_id`, índice y política RLS en la misma migración.
- [ ] Contratos y OpenAPI actualizados; claves i18n de los códigos de error nuevos en el frontend.
- [ ] Lint, tipos, pruebas y análisis de seguridad en verde.
- [ ] README del módulo y ADR actualizados si cambió una decisión.

## 16. Decisiones pendientes

Hallazgos del análisis del plan. Los ADR 0021 a 0024 (`docs/adr/`) están en estado **Propuesta** y se deciden antes de implementar el módulo afectado:

- [x] **Acceso previo a la autenticación con RLS** (ADR 0021): la base de datos ya incluye funciones `SECURITY DEFINER` mínimas en el esquema `auth` (migración 0008). Falta aceptar el ADR y consumirlas desde el módulo `identity` (fase 1a).
- [ ] **Auditoría de negaciones** (ADR 0022): se escribe en la misma transacción que la acción, que se revierte al negarse. Las negaciones necesitan una transacción independiente.
- [ ] **Advisory lock de auditoría** (ADR 0023): el trigger lo mantiene hasta el *commit*. Evaluar el impacto en transacciones largas.
- [ ] **Retención de auditoría** (ADR 0024) frente al `DELETE` revocado: definir particionado o un rol de archivado.
- [ ] **Índice ciego derivado de la DEK**: el plan deriva el índice ciego y las huellas de contraseña de la DEK con HKDF. Al rotar la DEK cambian todos los valores, así que cada rotación obliga a recalcular los índices (y, mientras conviven versiones, a buscar con ambas). `SecretCipher.blindIndex` ya devuelve la `dekVersion` usada. Decidir si se deriva de una clave por organización estable en lugar de la DEK.
- [ ] **Generador de OpenAPI** desde Zod: aprobar la dependencia.
- [ ] **Versión de PostgreSQL**: las pruebas usan 17; evaluar 18 si ya está disponible en el proveedor (UUIDv7 nativo).
- [ ] **`oidc-provider` sobre Fastify** (fase 2): está basado en Koa; validar con un *spike* antes de comprometerse.
- [ ] **Trabajos en segundo plano multi-organización**: se necesita un camino para listar organizaciones sin contexto (`auth.list_organization_ids()` propuesto en `docs/database.md` §7.5).
