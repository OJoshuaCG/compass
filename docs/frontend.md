# Guía de frontend

Reglas de arquitectura, estilos y componentes de `apps/web` (y de `apps/mobile-handoff` en lo que aplique). Complementa a `plan.md`: si algo aquí contradice al plan en seguridad, manda el plan.

## 1. Principios

1. **Estándar sobre ingenio.** Un problema, un componente. Si una pantalla necesita una tabla, usa `DataTable`; si necesita un botón, usa `Button`.
2. **Los tokens mandan.** Ningún color, tamaño, radio ni sombra se escribe a mano en un componente. Todo sale de variables globales.
3. **La UI nunca es la autorización.** Oculta lo que el usuario no puede hacer (según `/me`), pero el backend decide siempre.
4. **Los secretos son efímeros.** Viven solo en el estado del componente que los muestra.
5. **Accesible por defecto.** Teclado, foco visible, etiquetas y contraste son parte de "terminado".
6. **Dos idiomas desde la primera pantalla.** Ningún texto visible se escribe literal en un componente.

## 2. Stack

| Capa | Elección | Notas |
| --- | --- | --- |
| Lenguaje | TypeScript `strict` | Mismas banderas que el backend (ver plan, "TypeScript") |
| UI | React (última estable) + Vite | SPA en el mismo origen que la API |
| Enrutado | TanStack Router | El estado de las tablas vive en la URL, validado con Zod |
| Datos del servidor | TanStack Query | Sin store global salvo necesidad demostrada |
| Estilos | Tailwind CSS v4, configuración en CSS (`@theme`) | Tokens como variables CSS |
| Primitivas accesibles | Radix UI | Diálogos, menús, selects, tooltips |
| Formularios | react-hook-form + Zod | Esquemas desde `packages/contracts` |
| i18n | i18next + ICU | `es-MX` y `en-US` |
| Íconos | `lucide-react` | Siempre con texto o `aria-label` |
| Tablas | `@tanstack/react-table` (modo manual) | Solo lógica; el diseño es nuestro |
| Variantes de componentes | `class-variance-authority`, `clsx`, `tailwind-merge` | Una función `cn()` en `shared/lib` |
| Fuentes | Google Fonts: Inter, Space Grotesk, JetBrains Mono, vía `@fontsource-variable/*` | Mismas fuentes de Google, servidas desde nuestro origen (CSP sin terceros) |

> **Pendiente de aprobación humana** (regla de dependencias del plan): `@tanstack/react-table`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `@fontsource-variable/inter`, `@fontsource-variable/space-grotesk`, `@fontsource-variable/jetbrains-mono`. Cada una necesita justificación (mantenimiento, licencia, alternativas) antes de instalarse. Versiones exactas y lockfile, como el resto del monorepo.

## 3. Arquitectura

### Decisión: no hexagonal completa en el frontend

La hexagonal del backend existe para aislar el dominio de la base de datos y los proveedores. En el frontend el "dominio" es delgado (la autorización real vive en el servidor) y los puertos serían interfaces con una sola implementación: costo sin beneficio. Se adopta una versión ligera que conserva lo útil: **dependencias en una sola dirección, bordes explícitos y lógica pura separada de la UI**.

Tres ideas combinadas:

- **Por funcionalidad** (`features/*`), como pide el plan.
- **Capas dentro de cada feature**, con regla de dependencia (sección 3.2).
- **Atomic design** para `shared/ui`, y **container/presentational** para las pantallas.

### 3.1 Estructura

```
apps/web/src/
├─ app/                    # arranque: providers, router, i18n, query client
├─ routes/                 # un archivo por ruta; solo ensambla features (containers)
├─ features/
│  └─ vault/
│     ├─ api/              # hooks de Query/mutations y cliente HTTP del feature
│     ├─ model/            # TS puro: mapeos, reglas de UI, selectores (sin React)
│     ├─ ui/               # componentes del feature (presentacionales)
│     ├─ containers/       # componentes que conectan api + ui
│     ├─ i18n/             # claves del namespace (es.json, en.json)
│     └─ index.ts          # fachada pública del feature
└─ shared/
   ├─ ui/
   │  ├─ atoms/            # Button, Input, Badge, Spinner, Icon, Avatar...
   │  ├─ molecules/        # FormField, SearchInput, ConfirmDialog, EmptyState...
   │  └─ organisms/        # DataTable, PageHeader, AppShell, SecretReveal...
   ├─ lib/                 # cn(), formato de fechas (Intl), utilidades puras
   ├─ api/                 # cliente HTTP base, Problem Details, Idempotency-Key
   ├─ auth/                # useMe(), usePermission(), reautenticación (step-up)
   ├─ i18n/                # configuración y catálogos comunes
   └─ styles/              # tokens.css, base.css (único punto de estilos globales)
```

> **Nota (fase 0): paquetes compartidos.** Lo reutilizable entre `apps/web` y `apps/mobile-handoff` vive en paquetes del monorepo, consumidos como código fuente TypeScript: `packages/ui` (`@iam/ui`: `cn()`, `tokens.css` y los átomos, moléculas y organismos de `shared/ui`) y `packages/i18n` (`@iam/i18n`: catálogos `common` y `errors`, tipos y utilidades). `apps/web/src/shared` conserva solo lo específico de la app: `api`, `auth`, la configuración de arranque de `i18n` (i18next, detección en el primer acceso, selector de idioma, hooks de etiquetas y errores), `lib` y `styles/base.css` (enlaza los tokens de `@iam/ui` y el `@source` de Tailwind). Donde este documento dice `shared/ui` o `shared/styles/tokens.css`, léase `packages/ui`. La regla de dependencia de §3.2 no cambia.

### 3.2 Regla de dependencia

| Capa | Puede importar |
| --- | --- |
| `shared/*` | Solo `shared/*` y `packages/*`. **Nunca** `features` |
| `features/X/model` | Solo TS puro y `packages/contracts`. Sin React ni Tailwind |
| `features/X/api` | `model` del mismo feature, `shared/api`, `packages/contracts` |
| `features/X/ui` | `model`, `shared/ui`, `shared/lib` |
| `features/X/containers` | `api`, `ui`, `model` del mismo feature y `shared/*` |
| `routes/*` | La fachada (`index.ts`) de los features y `shared/*` |
| Entre features | **Solo** por la fachada (`index.ts`). Nada de rutas internas |

Se verifica con `eslint-plugin-boundaries` y dependency-cruiser en CI, igual que el backend. Una regla sin lint se rompe.

### 3.3 Container y presentational

- **Presentacional** (`ui/`, `shared/ui`): recibe datos y callbacks por props, no sabe de HTTP, rutas ni permisos. Se prueba con props.
- **Container** (`containers/`, `routes/`): obtiene datos (`useQuery`), traduce errores, decide permisos y pasa todo al presentacional.

## 4. Sistema de diseño

### 4.1 Tokens

Todo en `shared/styles/tokens.css`. Los componentes usan **solo** utilidades semánticas (`bg-surface`, `text-secondary`), nunca `bg-[#16191D]` ni la paleta por defecto de Tailwind.

Paleta "carbón": casi negro con un leve matiz frío, sin llegar a `#000`. Los contrastes están medidos con la fórmula WCAG 2.x.

```css
@import "tailwindcss";

:root {
  color-scheme: dark;

  /* Superficies (de más profundo a más elevado) */
  --color-canvas:   #0f1114;
  --color-surface:  #16191d;
  --color-raised:   #1c2025;
  --color-overlay:  #23282f;

  /* Texto */
  --color-text:           #e8eaed;
  --color-text-secondary: #a8afba;
  --color-text-muted:     #8b93a0;
  --color-text-disabled:  #69717d;

  /* Bordes */
  --color-border:        #2a2f37; /* separadores decorativos */
  --color-border-strong: #454d59; /* tarjetas, tablas */
  --color-border-input:  #656e7a; /* controles interactivos (≥3:1) */

  /* Marca y estados */
  --color-accent:         #6aa6ff;
  --color-accent-solid:   #2f6fe0;
  --color-accent-solid-hover: #2563c9;
  --color-on-accent:      #ffffff;
  --color-success:        #4cc49a;
  --color-warning:        #e8b04a;
  --color-danger:         #ff7a85;
  --color-danger-solid:   #c93843;
  --color-focus:          #6aa6ff;

  /* Forma y movimiento */
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --shadow-overlay: 0 8px 24px rgb(0 0 0 / 0.45);
  --duration-fast: 120ms;
  --duration-base: 200ms;
}

@theme inline {
  --color-canvas: var(--color-canvas);
  --color-surface: var(--color-surface);
  --color-raised: var(--color-raised);
  --color-overlay: var(--color-overlay);
  --color-text: var(--color-text);
  --color-text-secondary: var(--color-text-secondary);
  --color-text-muted: var(--color-text-muted);
  --color-text-disabled: var(--color-text-disabled);
  --color-border: var(--color-border);
  --color-border-strong: var(--color-border-strong);
  --color-border-input: var(--color-border-input);
  --color-accent: var(--color-accent);
  --color-accent-solid: var(--color-accent-solid);
  --color-success: var(--color-success);
  --color-warning: var(--color-warning);
  --color-danger: var(--color-danger);
  --color-danger-solid: var(--color-danger-solid);
  --font-sans: "Inter Variable", ui-sans-serif, system-ui, sans-serif;
  --font-heading: "Space Grotesk Variable", "Inter Variable", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono Variable", ui-monospace, monospace;
  --radius-sm: var(--radius-sm);
  --radius-md: var(--radius-md);
  --radius-lg: var(--radius-lg);
}
```

Reglas:

- **Un solo juego de valores oscuros** (decisión del plan). No hay `dark:` ni modo claro; las variables permiten cambiar la paleta en un solo archivo.
- Para añadir un color nuevo: se agrega el token, se mide el contraste y se documenta aquí.
- Valores arbitrarios de Tailwind (`w-[137px]`) prohibidos salvo justificación en un comentario. Lint con `eslint-plugin-tailwindcss` (aprobación pendiente).

### 4.2 Contraste medido (razón sobre `canvas` / `surface` / `raised`)

| Token | canvas | surface | raised | Uso |
| --- | --- | --- | --- | --- |
| `text` | 15.7 | 14.6 | 13.6 | Texto principal |
| `text-secondary` | 8.6 | 8.0 | 7.4 | Texto de apoyo |
| `text-muted` | 6.1 | 5.7 | 5.3 | Metadatos, placeholders |
| `accent` | 7.7 | 7.1 | 6.6 | Enlaces, foco |
| `success` / `warning` / `danger` | ≥7.5 / ≥8.4 / ≥6.5 | | | Texto de estado |
| `border-input` | 3.7 | 3.4 | 3.2 | Bordes de controles (WCAG 1.4.11, ≥3:1) |
| `text-disabled` | 3.8 | 3.6 | 3.3 | Solo controles inactivos |

- Botón sólido: blanco sobre `accent-solid` = 4.7; sobre `danger-solid` = 5.1.
- **Decisión documentada:** `text-disabled` queda por debajo de 4.5 porque WCAG exime a los controles inactivos, y bajar el contraste es lo que los hace verse deshabilitados. Nunca se usa para información que el usuario deba leer; el estado se refuerza con `disabled`/`aria-disabled`, cursor y, si hace falta, texto.
- Una prueba automática recorre los pares anteriores y falla si alguno baja del umbral (ver sección 11).

### 4.3 Tipografía

Tres familias de Google Fonts, cada una con un papel fijo:

| Papel | Fuente | Utilidad Tailwind | Dónde se usa |
| --- | --- | --- | --- |
| Principal | **Inter** | `font-sans` (por defecto) | Cuerpo, formularios, tablas, botones |
| Encabezados | **Space Grotesk** | `font-heading` | `h1`–`h4`, títulos de página y de tarjeta, cifras destacadas |
| Monoespaciada | **JetBrains Mono** | `font-mono` | Códigos TOTP, claves, IDs, `requestId`, fragmentos de auditoría |

Por qué funciona: Inter es neutra y muy legible en interfaces densas y tiene cifras tabulares; Space Grotesk aporta el toque tecnológico solo donde se ve poco texto (encabezados), sin cansar en párrafos; JetBrains Mono distingue bien caracteres ambiguos (`0/O`, `1/l`), clave para leer secretos y códigos.

- **Se sirven desde nuestro origen, no desde `fonts.googleapis.com`.** Son las mismas fuentes de Google, empaquetadas con `@fontsource-variable/*`. Cargarlas desde el CDN de Google exigiría abrir `style-src` y `font-src` a terceros y filtraría la IP de cada usuario, lo que choca con la CSP estricta del plan (`font-src 'self'`).
- Los `h1`–`h4` usan `font-heading` desde `base.css`; los componentes no lo repiten en cada uso. El resto del texto hereda `font-sans`.
- Fuentes variables (un `woff2` por familia). `font-display: swap`; precarga solo de Inter, que es la que pinta el primer contenido.
- Se importa solo el subconjunto latino (cubre español e inglés) para reducir peso.
- Cifras alineadas en tablas y códigos TOTP: `tabular-nums`.
- Escala (en `rem`, respeta el zoom del usuario): `text-xs` 12 · `text-sm` 14 (cuerpo en tablas) · `text-base` 16 (cuerpo) · `text-lg` 18 · `text-xl` 20 · `text-2xl` 24 · `text-3xl` 30.
- Interlineado 1.5 en texto corrido, 1.25 en encabezados.

### 4.4 Espaciado y layout

- Escala de 4 px de Tailwind (`1` = 4 px). Prohibidos valores fuera de escala.
- Mobile-first; puntos de quiebre estándar. La app es interna de escritorio, pero `mobile-handoff` y las pantallas de login deben funcionar en teléfono.
- Contenedor de contenido con ancho máximo; las tablas ocupan el ancho disponible con scroll horizontal contenido (no de la página).

## 5. Componentes

### 5.1 Reglas

1. **Todo lo visual reutilizable vive en `shared/ui`** (en la práctica, el paquete `packages/ui`; ver nota de §3.1). Un componente se usa en dos o más lugares o no sube a `shared`.
2. **Variantes con `cva`**, nunca condicionales de clases dispersos. Una prop `variant`/`size` por eje.
3. **Componentes sin lógica de negocio**: no importan `features`, ni `fetch`, ni hacen autorización.
4. **Accesibles por contrato**: Radix cuando existe la primitiva; si no, `aria-*` y teclado documentados en el propio componente.
5. **Composición sobre configuración masiva.** Preferir `children` y *slots* a 15 props booleanas.
6. **Sin estilos en línea ni `className` externo que rompa el diseño**: se permite `className` solo para layout (márgenes, grid) y pasa por `cn()`.
7. **Cada componente exporta su tipo de props** y tiene un archivo de prueba junto a él.
8. **Ningún texto literal**: los componentes reciben textos por props o usan claves i18n del feature.

### 5.2 Catálogo mínimo

| Nivel | Componentes |
| --- | --- |
| Átomos | `Button`, `IconButton`, `Input`, `Textarea`, `Select`, `Checkbox`, `Switch`, `Badge`, `Spinner`, `Skeleton`, `Icon`, `Avatar`, `Kbd`, `Tooltip` |
| Moléculas | `FormField` (label + control + ayuda + error), `SearchInput`, `PasswordInput`, `CopyButton`, `ConfirmDialog`, `EmptyState`, `Toast`, `Pagination`, `SortableHeader`, `StatusBadge`, `CodeDisplay` (monoespaciada, con copiado) |
| Organismos | `DataTable`, `PageHeader`, `AppShell` (barra lateral + cabecera), `SecretReveal` (oculta a 30 s), `ReauthDialog`, `ErrorBoundary`, `Timeline` (auditoría) |

> **Estado de la fase 0.** Implementados: `Button`, `IconButton`, `Input`, `NativeSelect` (selector nativo, usado en el límite de filas y el idioma), `Badge`, `Spinner`, `Skeleton`, `FormField`, `SearchInput`, `Pagination`, `SortableHeader`, `EmptyState`, `StatusBadge`, `ConfirmDialog`, `DataTable`, `PageHeader` y `AppShell`. Pendientes del catálogo mínimo: `Textarea`, `Select` (Radix), `Checkbox`, `Switch`, `Icon`, `Avatar`, `Kbd`, `Tooltip`, `PasswordInput`, `CopyButton`, `Toast`, `CodeDisplay`, `SecretReveal`, `ReauthDialog`, `ErrorBoundary` y `Timeline`. Los íconos se importan desde `@iam/ui` (`icons.ts`), que centraliza `lucide-react`.

Los botones tienen estados `default`, `hover`, `focus-visible`, `active`, `disabled` y `loading`. En `loading` el botón queda deshabilitado, conserva su ancho y anuncia el estado con `aria-busy`.

### 5.3 Estados de color

El estado nunca se comunica solo con el color: siempre ícono o texto (regla del plan). `StatusBadge` lo garantiza (ícono + etiqueta + color).

## 6. `DataTable`: la tabla estándar

**Toda tabla de la aplicación usa `DataTable`.** No hay tablas hechas a mano. Un solo organismo garantiza que el orden, la paginación, los estados vacío y de error y la accesibilidad sean idénticos en todas partes.

### 6.1 Anatomía

```
┌─ Barra superior (opcional) ───────────────────────────────┐
│ [Buscar…]            [Filtros]                [Acciones]  │
├─ Encabezado ──────────────────────────────────────────────┤
│ Nombre ▲        Plataforma ⇅      Estado ⇅      Creada ⇅  │
├─ Cuerpo ──────────────────────────────────────────────────┤
│ fila · fila · fila …                                      │
├─ Pie ─────────────────────────────────────────────────────┤
│ Mostrando 1–25      Filas por página [25 ▾]   [‹ Ant] [Sig ›] │
└───────────────────────────────────────────────────────────┘
```

### 6.2 Comportamiento obligatorio

- **Encabezado con ordenamiento**: solo en columnas marcadas `sortable`. Ciclo ascendente → descendente → sin orden. Indicador visual y `aria-sort`. El ordenamiento es **del servidor** y solo por campos indexados (regla del plan); la columna declara su `sortKey` y el contrato de la API lo valida.
- **Límite de objetos por página**: selector con valores fijos `10 · 25 · 50 · 100`, por defecto 25. Ninguna tabla carga más de 100 filas.
- **Paginación en el pie**: `Pagination` con "Anterior/Siguiente", rango visible y el selector de filas por página.
- **Paginación por cursor** (decisión del plan: `?cursor=&limit=`): el pie ofrece Anterior/Siguiente y no números de página ni salto a la página N. El componente guarda en memoria la pila de cursores para poder retroceder. Un total exacto solo se muestra si el endpoint lo entrega; no se calcula con offset.
- **Estado en la URL**: `sort`, `dir`, `limit`, `q` y filtros viven en los parámetros de búsqueda del router (validados con Zod). Así recargar o compartir el enlace conserva la vista. El cursor **no** va en la URL (caduca y no es compartible).
- **Estados**: cargando (esqueleto con las mismas columnas, sin saltos de layout), vacío (`EmptyState` con acción sugerida), vacío por filtros (con botón "Limpiar filtros") y error (mensaje traducido del código de la API + "Reintentar").
- **Cambio de página sin parpadeo**: se conserva la página anterior mientras llega la siguiente (`placeholderData: keepPreviousData` de TanStack Query) con indicador de carga sutil.
- **Acciones por fila**: menú de "⋯" con teclado; las destructivas piden `ConfirmDialog`. Las acciones visibles dependen de permisos de `/me`, solo como comodidad.
- **Selección múltiple** (si el caso la exige): casilla por fila y en el encabezado, con contador y barra de acciones masivas.
- **Densidad única**: una sola altura de fila. Texto secundario en `text-secondary`; cifras con `tabular-nums`.

### 6.3 Contrato del componente

```tsx
type Column<T> = {
  id: string;
  header: string;            // ya traducido por el container
  cell: (row: T) => ReactNode;
  sortKey?: string;          // presente = ordenable
  align?: "start" | "end";
};

type DataTableProps<T> = {
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  status: "loading" | "success" | "error";
  sort?: { key: string; dir: "asc" | "desc" };
  onSortChange: (sort?: { key: string; dir: "asc" | "desc" }) => void;
  limit: 10 | 25 | 50 | 100;
  onLimitChange: (limit: number) => void;
  pagination: {
    hasPrevious: boolean;
    hasNext: boolean;
    onPrevious: () => void;
    onNext: () => void;
    total?: number;
  };
  emptyState: ReactNode;
  errorState?: { message: string; onRetry: () => void };
  rowActions?: (row: T) => ReactNode;
  caption: string;           // obligatoria: describe la tabla (accesibilidad)
};
```

`DataTable` es presentacional: no hace peticiones. Un hook estándar `useTableQuery` (en `shared/api`) une la URL, el cursor y TanStack Query, de modo que cada pantalla solo declara columnas y endpoint.

### 6.4 Accesibilidad de la tabla

Marcado semántico (`<table>`, `<caption>`, `<th scope>`), `aria-sort` en el encabezado activo, navegación por teclado en encabezados y acciones, foco visible y anuncio del cambio de página en una región `aria-live="polite"`.

## 7. Datos, errores y sesión

### 7.1 Cliente HTTP

Un solo cliente en `shared/api`:

- Misma origen, cookie `__Host-session`; sin tokens en JS.
- Añade `X-Requested-With` en peticiones que modifican (exigido por la protección CSRF del plan).
- Genera `Idempotency-Key` en los `POST` que crean recursos, estable ante reintentos.
- Envía `If-Match` con la versión del recurso en `PATCH`.
- Convierte toda respuesta de error en un `ApiError` tipado desde Problem Details (RFC 9457), con `code` y `requestId`.

### 7.2 Tratamiento por código HTTP

| Estado | Comportamiento de la UI |
| --- | --- |
| `401` | Cierra el estado de sesión local y redirige al login conservando la ruta de retorno |
| `403` | Mensaje traducido por `code`; no se reintenta |
| `403` por reautenticación requerida | Abre `ReauthDialog`; tras éxito, reintenta la acción una vez |
| `404` | Pantalla de "no encontrado" (no revela si existe) |
| `409` | Aviso de que el recurso cambió y opción de recargar (conflicto de `If-Match`) |
| `422` | Errores por campo en el formulario, desde la lista de campos inválidos |
| `429` | Aviso con el tiempo de espera; botón deshabilitado hasta entonces |
| `5xx` / red | Error genérico con `requestId` visible para soporte y "Reintentar" |

### 7.3 TanStack Query

- Fábrica de *query keys* por feature (`vaultKeys.list(filters)`); nunca cadenas sueltas.
- Las mutaciones invalidan por clave, no recargan la página.
- `staleTime` explícito por tipo de dato; los secretos revelados **no** pasan por la caché de Query (ver sección 9).
- Los errores esperados se manejan en el container; un `ErrorBoundary` por ruta atrapa los inesperados.

## 8. Formularios

- `react-hook-form` + esquemas Zod de `packages/contracts`. El frontend no redefine validaciones del backend.
- `FormField` une etiqueta, control, ayuda y error con `aria-describedby` y `aria-invalid`.
- Validación al enviar y, tras el primer error, al cambiar.
- Los errores `422` del servidor se mapean a campos con `setError`.
- Botón de envío deshabilitado y en `loading` durante la mutación (evita doble envío).
- Los campos de contraseña usan `PasswordInput` (mostrar/ocultar), con `autocomplete` correcto; el medidor de fortaleza no envía la contraseña a terceros.

## 9. Seguridad en el navegador

Todo lo del plan, convertido en reglas verificables:

- **CSP estricta** definida por el backend: sin `unsafe-inline` ni `unsafe-eval`; `script-src 'self'`; `frame-ancestors 'none'`; `connect-src 'self'`. Por eso los estilos son clases de Tailwind (sin `style=` ni `<style>` en línea) y las fuentes se autoalojan.
- **Trusted Types activado.** Prohibido `dangerouslySetInnerHTML`, `innerHTML` y `eval` (lint como error). Si alguna vez hace falta HTML, solo con una política de Trusted Types revisada.
- **Nada sensible en `localStorage`, `sessionStorage` ni IndexedDB.** Preferencias no sensibles (por ejemplo, filas por página) sí pueden usar `localStorage`, siempre con `try/catch`.
- **Secretos revelados**: viven en el estado local del componente `SecretReveal`, **nunca** en la caché de TanStack Query, en un contexto global ni en la URL. Se descartan al ocultar (30 s), al desmontar o al cerrar sesión. Las peticiones de revelación van con `Cache-Control: no-store` (backend) y la mutación se configura con `gcTime: 0`.
- **Portapapeles**: al copiar un secreto se limpia a los 30 s (mejor esfuerzo, documentado en la UI).
- **Sesión**: cierre por inactividad sincronizado entre pestañas con `BroadcastChannel`; al expirar se limpian estados sensibles.
- **Registros**: prohibido `console.log` de respuestas de rutas sensibles; lint `no-console` como error en producción.
- **Dependencias**: mismo control que el backend (versiones exactas, espera de 7 días, aprobación humana). Un paquete comprometido en la SPA ve todo lo que el usuario revela.
- **Enlaces externos**: `rel="noopener noreferrer"`.

## 10. Internacionalización

- `i18next` con un espacio de nombres por feature (`vault`, `directory`, `auth`, `common`). Claves semánticas: `vault.reveal.confirmTitle`, nunca el texto en inglés como clave.
- Idiomas: `es-MX` y `en-US`. El idioma se guarda en el perfil del usuario; la detección del navegador solo ocurre en el primer acceso.
- **Estado de la fase 0:** los catálogos son JSON planos con puntos literales en la clave (`table.next`) y i18next se inicia con `keySeparator: false`, de modo que la clave de un error de la API es el propio código (`AUTHZ.HIERARCHY.NOT_IN_SUBTREE`). Las variables usan la interpolación nativa `{{var}}`; ICU (`i18next-icu`) queda pendiente de aprobación como dependencia. La prueba de paridad también compara las variables de cada texto; la de «claves sin uso» aún no existe.
- Plurales y variables con ICU. Fechas, números y horas con `Intl` en la zona horaria del usuario (en `shared/lib`; nadie llama a `toLocaleString` directamente).
- Los códigos de error de la API (`AUTHZ.HIERARCHY.NOT_IN_SUBTREE`) se traducen con una clave derivada del código; si falta, se usa un mensaje genérico y se registra.
- **Prueba de CI**: falla si una clave existe en un idioma y no en el otro, o si hay claves sin uso.
- Los textos largos (el español suele ser ~20 % más largo) no deben romper el diseño: nada de anchos fijos en botones ni encabezados de tabla.
- Los textos de los catálogos viven junto a su feature (`features/X/i18n`); los comunes en `shared/i18n`.

## 11. Pruebas

| Tipo | Herramienta | Qué cubre |
| --- | --- | --- |
| Unitarias | Vitest | `model/`, `shared/lib`, validaciones, formateo |
| Componentes | Vitest + Testing Library | Interacción accesible (por rol y etiqueta, no por clases) |
| Accesibilidad | `axe-core` directo con un helper propio (`vitest-axe` está desactualizado) | Cada componente de `shared/ui` y cada pantalla. jsdom no calcula estilos: `color-contrast` se desactiva en axe y lo cubre la prueba de tokens |
| Tokens | Vitest | Contraste de los pares de la sección 4.2 |
| i18n | Vitest | Paridad de claves `es`/`en` |
| Arquitectura | `eslint-plugin-boundaries`, dependency-cruiser | Regla de dependencia (sección 3.2) |
| E2E | Playwright | Flujos críticos del plan (invitación, passkey, compartir, revelar, 2FA, baja) |

- Se prueban **comportamientos**, no implementación: se busca por rol, etiqueta o texto traducido, nunca por clase CSS.
- `DataTable` tiene su propia suite: orden, límite, paginación por cursor, estados vacío/error/carga y teclado.
- Las pruebas de secretos verifican que un valor revelado no queda en la caché de Query ni en el almacenamiento del navegador tras ocultarlo.

## 12. Rendimiento

- Partición de código **por ruta** (`lazy` de TanStack Router); el login no descarga la bóveda.
- Presupuesto inicial de JS (gzip) a fijar en la fase 0 y vigilado en CI (propuesta de partida: 200 KB en la ruta de entrada). Un PR que lo supere explica por qué.
- Sin listas virtualizadas: la paginación del servidor acota las filas (máximo 100).
- Fuentes: un solo archivo variable por familia (Inter, Space Grotesk, JetBrains Mono), subconjunto latino y `swap`. Solo Inter se precarga; las otras dos cargan al necesitarse.
- Imágenes e íconos: SVG en línea por `lucide-react` (se importa solo lo usado, sin importar el paquete completo).

## 13. Accesibilidad

- Navegación completa por teclado; orden de tabulación lógico; sin trampas de foco (Radix gestiona el foco de diálogos y menús).
- Foco visible con `--color-focus` en **todos** los controles interactivos (`focus-visible`), nunca `outline: none` sin sustituto.
- Todo control tiene nombre accesible; los botones con solo ícono llevan `aria-label` traducido.
- Anuncios con `aria-live` para acciones como "Contraseña copiada" y cambios de página.
- Contraste AA verificado por la prueba de tokens.
- Respeta `prefers-reduced-motion`: las transiciones se reducen a instantáneas.
- Áreas táctiles de al menos 24 × 24 px (WCAG 2.2, 2.5.8).

## 14. Convenciones de código

- Nombres en inglés en el código; comentarios y documentación en español. Los comentarios explican **por qué**, no qué.
- Componentes en `PascalCase`, hooks `useXxx`, archivos `kebab-case.tsx`. Un componente por archivo.
- `export` nombrados (sin `default`), salvo lo que el enrutador exija. Cada feature y cada carpeta de `shared/ui` expone solo su `index.ts`.
- Sin `any`; `unknown` y validación con Zod en los bordes de red. Identificadores con tipos de marca (`UserId`, `CredentialId`).
- Estado en el lugar más bajo posible: local → URL → Query → contexto. Sin store global salvo necesidad demostrada.
- Efectos (`useEffect`) solo para sincronizar con sistemas externos; no para derivar estado.
- TSDoc en los componentes de `shared/ui` y en las fachadas de los features.
- Funciones y componentes cortos: si un archivo pasa de ~200 líneas, es una señal para dividirlo (no una regla mecánica).
- Conventional Commits y PR pequeños, como el resto del monorepo.

## 15. Definición de terminado (frontend)

- [ ] Usa componentes de `shared/ui`; no hay tablas, botones ni campos hechos a mano.
- [ ] Sin colores, tamaños ni sombras literales; solo tokens.
- [ ] Claves i18n en `es-MX` y `en-US`; ningún texto literal.
- [ ] Teclado, foco visible y etiquetas verificados; prueba de accesibilidad en verde.
- [ ] Manejo de `401/403/404/409/422/429/5xx` según la sección 7.2.
- [ ] Las tablas usan `DataTable` con orden, límite y paginación.
- [ ] Ningún secreto fuera del estado del componente.
- [ ] Lint, tipos, pruebas y límites de arquitectura en verde.
- [ ] Si toca rutas protegidas (CSP, autenticación), revisión doble.

## 16. Trabajo con agentes de frontend

Se puede apoyar el desarrollo del frontend en los agentes de Claude Code disponibles a nivel global. Son una ayuda para ejecutar, no una excepción a las reglas: **todo lo que produzcan debe cumplir esta guía**, y un humano revisa y se responsabiliza del resultado.

### Agentes y para qué sirven

| Agente | Úsalo para | Límites |
| --- | --- | --- |
| `frontend-developer` | Construir componentes de `shared/ui`, pantallas de un feature, formularios, tablas con `DataTable`, pruebas de componente | Escribe código; necesita alcance de archivos explícito |
| `typescript-pro` | Tipos de marca, genéricos de `DataTable` y `useTableQuery`, cliente HTTP tipado, tipos derivados de `contracts` | Solo tipos y utilidades; no decide arquitectura |
| `ui-ux-designer` | Auditar accesibilidad, contraste, consistencia con los tokens y usabilidad de una pantalla o componente | Solo lectura; entrega hallazgos, no edita |

### Cómo delegar

1. **Apunta a la guía por referencia.** El encargo empieza con "lee `docs/frontend.md` antes de escribir" y nombra las secciones que aplican (por ejemplo, 5 y 6 para una tabla). No se parafrasean las reglas.
2. **Alcance explícito de archivos.** Lista las rutas que el agente puede crear o editar (por ejemplo, `apps/web/src/features/vault/**` y `apps/web/src/shared/ui/organisms/data-table/**`). Nada fuera de ellas.
3. **Un encargo, una unidad de comportamiento**: componente + prueba + claves i18n juntos. No se separan en agentes distintos código, pruebas y textos.
4. **Reutilizar antes de crear.** Debe usar los componentes y helpers existentes (`DataTable`, `FormField`, `cn()`, `useTableQuery`) y no volver a implementarlos. Si falta uno en el catálogo, lo propone antes de crear una variante.
5. **Criterios de aceptación en el encargo**: la lista de la sección 15 y el comando de verificación (lint, tipos y pruebas).
6. **Resultado:** el agente informa qué archivos tocó, qué comprobó y qué no pudo comprobar.

### Lo que los agentes no hacen

- **No agregan dependencias.** Si creen que hace falta una, la proponen y se detienen (regla del plan).
- **No tocan rutas protegidas** sin que un humano lo pida: CSP y cabeceras, autenticación y reautenticación, `SecretReveal` y todo lo que maneje secretos.
- **No leen `.env*`** ni datos de producción; no ejecutan comandos de red ni de despliegue.
- **No inventan estilos:** nada de colores, tamaños ni sombras literales; solo tokens.
- **No marcan como terminado** lo que no comprobaron.

### Revisión

- Todo código de agente pasa por revisión humana, como cualquier PR. En rutas protegidas se revisa línea por línea y con dos revisores; "las pruebas pasan" no es criterio suficiente.
- Las pruebas de comportamiento críticas (secretos fuera de la caché, `DataTable`, manejo de `403` por reautenticación) las escribe o las revisa una persona: si el mismo agente escribe el código y su prueba, puede repetir el mismo error en ambos.
- Para una revisión independiente de una pantalla terminada, se usa `ui-ux-designer` (solo lectura) y sus hallazgos se triagean antes de actuar sobre ellos.

## 17. `CLAUDE.md` para `apps/web`

```markdown
# Reglas de apps/web
- Sigue docs/frontend.md. Si algo no está cubierto, propónlo y detente.
- Usa siempre componentes de shared/ui. Toda tabla es DataTable.
- Solo tokens de shared/styles/tokens.css. Prohibido color, tamaño o sombra literal.
- Ningún texto literal: claves i18n en es-MX y en-US.
- Respeta la regla de dependencia: shared no importa features; entre features, solo por index.ts.
- Prohibido dangerouslySetInnerHTML, innerHTML, eval y console.log de datos sensibles.
- Los secretos solo en estado local del componente; nunca en Query, contexto ni almacenamiento.
- No agregues dependencias. Si crees que hace falta una, propónla y detente.
- Nunca leas .env* ni datos de producción.
- No toques rutas protegidas (CSP, autenticación, SecretReveal) salvo encargo humano explícito.
- Si trabajas como agente delegado, limítate a las rutas indicadas en el encargo.

# Definición de terminado
- Pruebas de componente y de accesibilidad en verde.
- Paridad de claves i18n, contraste de tokens y límites de arquitectura en verde.
```

## 18. Decisiones pendientes

- [ ] **Aprobar las dependencias** de la sección 2 (cada una con su justificación).
- [ ] **Paginación**: confirmar el pie con Anterior/Siguiente por cursor. Si el equipo necesita números de página o salto a la página N, la API tendría que ofrecer offset en esos listados (contradice la regla actual del plan).
- [ ] **Presupuesto de JS** inicial (sección 12) a validar al arrancar la fase 0.
- [ ] **Catálogo visual** (Storybook u otro): no incluido; se evalúa cuando existan ~15 componentes. Requiere aprobación como dependencia.
