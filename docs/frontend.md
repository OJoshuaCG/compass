# Guía de frontend

Reglas de arquitectura, estilos y componentes de `apps/web` (y de `apps/mobile-handoff` en lo que aplique). Complementa a `plan.md`: si algo aquí contradice al plan en seguridad, manda el plan. Las reglas de negocio que la interfaz refleja están en [`business/`](business/README.md).

Esta guía describe reglas y decisiones; no incluye código. El catálogo de componentes se nombra como catálogo de diseño; las funciones y los hooks se describen por lo que hacen. La paleta de colores se documenta como tabla de valores.

## 1. Principios

1. **Estándar sobre ingenio.** Un problema, un componente. Si una pantalla necesita una tabla, usa la tabla estándar; si necesita un botón, usa el botón del catálogo.
2. **Los tokens mandan.** Ningún color, tamaño, radio ni sombra se escribe a mano en un componente. Todo sale de variables globales.
3. **La UI nunca es la autorización.** Oculta lo que el usuario no puede hacer (según los permisos que entrega el perfil del usuario autenticado), pero el backend decide siempre.
4. **Los secretos son efímeros.** Viven solo en el estado del componente que los muestra.
5. **Accesible por defecto.** Teclado, foco visible, etiquetas y contraste son parte de "terminado".
6. **Dos idiomas desde la primera pantalla.** Ningún texto visible se escribe literal en un componente.

## 2. Stack

| Capa | Elección | Notas |
| --- | --- | --- |
| Lenguaje | TypeScript en modo estricto | Mismas banderas que el backend (ver plan, "TypeScript") |
| UI | React (última estable) + Vite | SPA en el mismo origen que la API |
| Enrutado | TanStack Router | El estado de las tablas vive en la URL, validado con Zod |
| Datos del servidor | TanStack Query | Sin store global salvo necesidad demostrada |
| Estilos | Tailwind CSS v4, configuración en CSS | Tokens como variables CSS |
| Primitivas accesibles | Radix UI | Diálogos, menús, selects, tooltips |
| Formularios | react-hook-form + Zod | Esquemas desde `packages/contracts` |
| i18n | i18next + ICU | `es-MX` y `en-US` |
| Íconos | `lucide-react` | Siempre con texto o etiqueta accesible |
| Tablas | `@tanstack/react-table` (modo manual) | Solo lógica; el diseño es nuestro |
| Variantes de componentes | `class-variance-authority`, `clsx`, `tailwind-merge` | Una utilidad común para combinar clases en `shared/lib` |
| Fuentes | Google Fonts: Inter y JetBrains Mono, vía `@fontsource-variable/*` | Mismas fuentes de Google, servidas desde nuestro origen (CSP sin terceros) |

> **Estado de dependencias:** instaladas con versión exacta y lockfile, como el resto del monorepo. En `packages/ui`: `@tanstack/react-table`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react` y cinco paquetes de Radix (diálogo, menú, selector, ranura y información emergente). En `apps/web`: las tres familias `@fontsource-variable/*`, `@simplewebauthn/browser` (passkeys), `qrcode` (dibujar el código QR del registro del segundo factor), `react-hook-form` con `@hookform/resolvers`, TanStack Query y Router, `i18next` y `react-i18next`. Sigue sin instalarse `i18next-icu` (ver §10). El registro de la aprobación humana de cada una no está en el repositorio: confirmar con el equipo.

## 3. Arquitectura

### Decisión: no hexagonal completa en el frontend

La hexagonal del backend existe para aislar el dominio de la base de datos y los proveedores. En el frontend el "dominio" es delgado (la autorización real vive en el servidor) y los puertos serían interfaces con una sola implementación: costo sin beneficio. Se adopta una versión ligera que conserva lo útil: **dependencias en una sola dirección, bordes explícitos y lógica pura separada de la UI**.

Tres ideas combinadas:

- **Por funcionalidad** (`features/*`), como pide el plan.
- **Capas dentro de cada feature**, con regla de dependencia (sección 3.2).
- **Atomic design** para `shared/ui`, y **container/presentational** para las pantallas.

### 3.1 Estructura

Todo vive en `apps/web/src/`:

| Carpeta | Contenido |
| --- | --- |
| `app/` | Arranque: proveedores, enrutador, i18n y cliente de consultas |
| `routes/` | Un archivo por ruta; solo ensambla features (containers) |
| `features/<feature>/api/` | Consultas y mutaciones del feature y su cliente HTTP |
| `features/<feature>/model/` | TypeScript puro: mapeos, reglas de UI y selectores, sin React |
| `features/<feature>/ui/` | Componentes presentacionales del feature |
| `features/<feature>/containers/` | Componentes que conectan datos y presentación |
| `features/<feature>/i18n/` | Catálogos de textos del feature (español e inglés) |
| `features/<feature>/` (fachada) | Único punto de entrada público del feature |
| `shared/ui/atoms`, `molecules`, `organisms` | Componentes reutilizables por nivel de atomic design |
| `shared/lib/` | Utilidades puras: combinación de clases, formato de fechas con `Intl` |
| `shared/api/` | Cliente HTTP base, manejo de detalles de problema, claves de idempotencia |
| `shared/auth/` | Perfil del usuario, comprobación de permisos para la UI y reautenticación |
| `shared/i18n/` | Configuración y catálogos comunes |
| `shared/styles/` | Tokens de diseño y estilos base (único punto de estilos globales) |

> **Nota (fase 0): paquetes compartidos.** Lo reutilizable entre `apps/web` y `apps/mobile-handoff` vive en paquetes del monorepo, consumidos como código fuente TypeScript: `packages/ui` (`@iam/ui`: la utilidad de combinación de clases, los tokens y los átomos, moléculas y organismos de `shared/ui`) y `packages/i18n` (`@iam/i18n`: catálogos comunes y de errores, tipos y utilidades). `apps/web/src/shared` conserva solo lo específico de la app: `api`, `auth`, la configuración de arranque de i18n (detección en el primer acceso, selector de idioma, etiquetas y errores), `lib` y los estilos base (enlazan los tokens de `@iam/ui`). Donde este documento dice `shared/ui` o los tokens de `shared/styles`, léase `packages/ui`. La regla de dependencia de §3.2 no cambia.

### 3.2 Regla de dependencia

| Capa | Puede importar |
| --- | --- |
| `shared/*` | Solo `shared/*` y `packages/*`. **Nunca** `features` |
| `features/X/model` | Solo TypeScript puro y `packages/contracts`. Sin React ni Tailwind |
| `features/X/api` | `model` del mismo feature, `shared/api`, `packages/contracts` |
| `features/X/ui` | `model`, `shared/ui`, `shared/lib` |
| `features/X/containers` | `api`, `ui`, `model` del mismo feature y `shared/*` |
| `routes/*` | La fachada de los features y `shared/*` |
| Entre features | **Solo** por la fachada. Nada de rutas internas |

Se verifica con `eslint-plugin-boundaries` y dependency-cruiser en CI, igual que el backend. Una regla sin lint se rompe.

### 3.3 Container y presentational

- **Presentacional** (`ui/`, `shared/ui`): recibe datos y callbacks por props, no sabe de HTTP, rutas ni permisos. Se prueba con props.
- **Container** (`containers/`, `routes/`): obtiene datos, traduce errores, decide permisos y pasa todo al presentacional.

## 4. Sistema de diseño

### 4.1 Tokens

Todos los tokens viven en el archivo de tokens de `packages/ui` (ver nota de §3.1). Los componentes usan **solo** utilidades semánticas (superficie, texto secundario), nunca un color literal ni la paleta por defecto de Tailwind.

Paleta "Compass": tema claro sobre la escala azul de CIROX (sistema de diseño de INBTEL). Fondo gris azulado, tarjetas blancas, texto azul marino y la navegación en azul marino profundo. Los contrastes están medidos con la fórmula WCAG 2.x. Tailwind consume cada token mediante el bloque de tema del CSS; las familias tipográficas, los radios y las sombras también se publican como tokens.

**Superficies**

| Token | Valor | Uso |
| --- | --- | --- |
| canvas | `#f2f5fb` | Fondo de página |
| surface | `#ffffff` | Tarjetas, tablas, barra superior |
| raised | `#e8f0fa` | Hover, fila o elemento activo |
| overlay | `#ffffff` | Diálogos y menús (se separan con sombra) |

**Texto**

| Token | Valor |
| --- | --- |
| text | `#0f1f3d` |
| text-secondary | `#374151` |
| text-muted | `#5a6475` |
| text-disabled | `#7c8594` |

**Bordes**

| Token | Valor | Uso |
| --- | --- | --- |
| border | `#e5e7eb` | Separadores decorativos |
| border-strong | `#c3ccd9` | Tarjetas y tablas |
| border-input | `#6b7280` | Controles interactivos (contraste mínimo de 3:1) |

**Marca y estados**

| Token | Valor |
| --- | --- |
| accent | `#1956b0` |
| accent-solid | `#2d6bcb` |
| accent-solid-hover | `#1956b0` |
| on-accent | `#ffffff` |
| success | `#137238` |
| warning | `#a14a0b` |
| danger | `#b91c1c` |
| danger-solid | `#c62f3a` |
| focus | `#1956b0` |

**Fondos suaves de estado** (círculos de íconos; el color del estado sobre ellos llega a 4.5:1)

| Token | Valor | Contraste del estado encima |
| --- | --- | --- |
| success-soft | `#e1f3e7` | success 5.2 |
| warning-soft | `#fdf1dc` | warning 5.4 |
| danger-soft | `#fde8e8` | danger 5.5 |

**Navegación** (barra lateral y pantallas de acceso)

| Token | Valor | Uso |
| --- | --- | --- |
| nav | `#0c3572` | Fondo de la barra lateral y de las pantallas de acceso |
| nav-raised | `#1e4a8a` | Elemento activo o con hover, avatar |
| nav-text | `#ffffff` | Texto principal sobre nav |
| nav-text-muted | `#c8def5` | Enlaces inactivos y etiquetas sobre nav |
| nav-focus | `#a3c6ee` | Contorno de foco dentro de la navegación |

**Forma y movimiento**

| Token | Valor |
| --- | --- |
| radio pequeño / medio / grande | 0.375 rem / 0.5 rem / 0.75 rem |
| sombra de tarjeta | desplazamiento vertical de 4 px, desenfoque de 16 px, azul marino con 8 % de opacidad |
| sombra de capas superpuestas | desplazamiento vertical de 8 px, desenfoque de 32 px, azul marino con 16 % de opacidad |
| duración rápida / base | 120 ms / 200 ms |
| esquema de color del navegador | claro |

Reglas:

- **Un solo juego de valores claros.** La decisión original del plan era un tema oscuro único; se cambió por el tema claro del diseño de Compass (prototipo en Claude Design con el sistema CIROX). Sigue sin haber variantes por modo; las variables permiten cambiar la paleta en un solo archivo.
- La navegación es la única zona oscura: dentro de ella el foco usa nav-focus, porque el foco general (azul) no contrasta con el fondo marino.
- Para añadir un color nuevo: se agrega el token, se mide el contraste y se documenta aquí.
- Valores arbitrarios de Tailwind (anchos o tamaños sueltos) prohibidos salvo justificación en un comentario. Lint con `eslint-plugin-tailwindcss` (aprobación pendiente).

### 4.2 Contraste medido (razón sobre canvas / surface / raised)

| Token | canvas | surface | raised | Uso |
| --- | --- | --- | --- | --- |
| text | 15.0 | 16.4 | 14.2 | Texto principal |
| text-secondary | 9.4 | 10.3 | 9.0 | Texto de apoyo |
| text-muted | 5.5 | 6.0 | 5.2 | Metadatos, placeholders |
| accent | 6.4 | 7.0 | 6.1 | Enlaces, foco |
| success / warning / danger | ≥5.2 / ≥5.2 / ≥5.6 | | | Texto de estado |
| border-input | 4.4 | 4.8 | 4.2 | Bordes de controles (WCAG 1.4.11, ≥3:1) |
| text-disabled | 3.4 | 3.7 | 3.2 | Solo controles inactivos |

- Botón sólido: blanco sobre accent-solid = 5.2; sobre danger-solid = 5.4.
- Navegación (sobre nav / nav-raised): nav-text 11.9 / 8.7; nav-text-muted 8.6 / 6.3; nav-focus 6.7 / 4.9.
- **Decisión documentada:** text-disabled queda por debajo de 4.5 porque WCAG exime a los controles inactivos, y bajar el contraste es lo que los hace verse deshabilitados. Nunca se usa para información que el usuario deba leer; el estado se refuerza con los atributos de accesibilidad de deshabilitado, el cursor y, si hace falta, texto.
- Una prueba automática recorre los pares anteriores y falla si alguno baja del umbral (ver sección 11).

### 4.3 Tipografía

Dos familias de Google Fonts, cada una con un papel fijo:

| Papel | Fuente | Dónde se usa |
| --- | --- | --- |
| Principal y encabezados | **Inter** | Cuerpo, formularios, tablas, botones; títulos de nivel 1 a 4 en negrita con interletrado cerrado |
| Monoespaciada | **JetBrains Mono** | Códigos TOTP, claves, identificadores, identificador de petición, fragmentos de auditoría |

Por qué funciona: Inter es neutra y muy legible en interfaces densas y tiene cifras tabulares; en negrita cubre los encabezados con el mismo tono que el diseño de Compass (que usa DM Sans, muy parecida; se mantuvo Inter para no añadir dependencias). JetBrains Mono distingue bien caracteres ambiguos (0/O, 1/l), clave para leer secretos y códigos. El token de fuente de encabezados se conserva y hoy apunta a Inter.

- **Se sirven desde nuestro origen, no desde los servidores de Google.** Son las mismas fuentes de Google, empaquetadas con `@fontsource-variable/*`. Cargarlas desde el CDN de Google exigiría abrir las políticas de estilos y fuentes a terceros y filtraría la IP de cada usuario, lo que choca con la CSP estricta del plan (fuentes solo del propio origen).
- Los títulos de nivel 1 a 4 usan la fuente y el peso de encabezados desde los estilos base; los componentes no lo repiten en cada uso. El resto del texto hereda la fuente principal.
- Fuentes variables (un archivo `woff2` por familia). Se muestra texto alternativo mientras carga; precarga solo de Inter, que es la que pinta el primer contenido.
- Se importa solo el subconjunto latino (cubre español e inglés) para reducir peso.
- Cifras alineadas en tablas y códigos TOTP: cifras tabulares.
- Escala (en `rem`, respeta el zoom del usuario): 12 px (texto extra pequeño), 14 (cuerpo en tablas), 16 (cuerpo), 18, 20, 24 y 30.
- Interlineado 1.5 en texto corrido, 1.25 en encabezados.

### 4.4 Espaciado y layout

- Escala de 4 px de Tailwind (la unidad 1 equivale a 4 px). Prohibidos valores fuera de escala.
- Mobile-first; puntos de quiebre estándar. La app es interna de escritorio, pero `mobile-handoff` y las pantallas de login deben funcionar en teléfono.
- Contenedor de contenido con ancho máximo; las tablas ocupan el ancho disponible con scroll horizontal contenido (no de la página).

## 5. Componentes

### 5.1 Reglas

1. **Todo lo visual reutilizable vive en `shared/ui`** (en la práctica, el paquete `packages/ui`; ver nota de §3.1). Un componente se usa en dos o más lugares o no sube a `shared`.
2. **Variantes con `class-variance-authority`**, nunca condicionales de clases dispersos. Una propiedad de variante o de tamaño por eje.
3. **Componentes sin lógica de negocio**: no importan `features`, ni hacen peticiones, ni autorizan.
4. **Accesibles por contrato**: Radix cuando existe la primitiva; si no, atributos de accesibilidad y teclado documentados en el propio componente.
5. **Composición sobre configuración masiva.** Preferir contenido anidado y *slots* a 15 propiedades booleanas.
6. **Sin estilos en línea ni clases externas que rompan el diseño**: se permiten clases externas solo para layout (márgenes, rejilla) y pasan por la utilidad común de combinación.
7. **Cada componente exporta el tipo de sus propiedades** y tiene un archivo de prueba junto a él.
8. **Ningún texto literal**: los componentes reciben textos por propiedades o usan claves i18n del feature.

### 5.2 Catálogo mínimo

| Nivel | Componentes |
| --- | --- |
| Átomos | Botón, botón de ícono, campo de texto, área de texto, selector, casilla, interruptor, insignia, indicador de carga, esqueleto, ícono, avatar, tecla, información emergente |
| Moléculas | Campo de formulario (etiqueta, control, ayuda y error), búsqueda, campo de contraseña, botón de copiar, diálogo de confirmación, estado vacío, aviso emergente, paginación, encabezado ordenable, insignia de estado, visor de códigos (monoespaciado, con copiado) |
| Organismos | Tabla de datos estándar (`DataTable`), encabezado de página, estructura de la aplicación (barra lateral y cabecera), revelador de secretos (se oculta a los 30 s), diálogo de reautenticación, contenedor de errores, línea de tiempo (auditoría) |

> **Estado tras la fase 1a.** Implementados en `packages/ui`: botón, botón de ícono, campo de texto, selector nativo (usado en el límite de filas y el idioma), casilla, insignia, indicador de carga, esqueleto, campo de formulario, búsqueda, paginación, encabezado ordenable, estado vacío, insignia de estado, diálogo, diálogo de confirmación, campo de contraseña con indicador de fortaleza, campo de código, botón de copiar, aviso, aviso emergente, grupo de opciones, pestañas, menú de acciones de fila, tabla de datos, encabezado de página, estructura de la aplicación y diálogo de reautenticación. Pendientes del catálogo mínimo: área de texto, selector con Radix, interruptor, avatar, tecla, información emergente, visor de códigos, revelador de secretos, contenedor de errores y línea de tiempo. Los íconos se importan desde un único archivo de `@iam/ui` que centraliza `lucide-react`.

Los botones tienen estados normal, hover, foco visible, activo, deshabilitado y en carga. En carga el botón queda deshabilitado, conserva su ancho y anuncia el estado a los lectores de pantalla.

### 5.3 Estados de color

El estado nunca se comunica solo con el color: siempre ícono o texto (regla del plan). La insignia de estado lo garantiza (ícono, etiqueta y color).

El aviso en línea fija su rol por tono: el de error (`danger`) es `role="alert"` y es el único asertivo; los de información, advertencia y éxito son `role="status"` (cortés), para que las notas fijas no interrumpan al lector de pantalla al abrir un diálogo. Una prueba en `packages/ui` fija el rol de cada tono.

## 6. La tabla estándar de datos

**Toda tabla de la aplicación usa la tabla de datos estándar.** No hay tablas hechas a mano. Un solo organismo garantiza que el orden, la paginación, los estados vacío y de error y la accesibilidad sean idénticos en todas partes.

### 6.1 Anatomía

De arriba abajo, la tabla tiene cuatro zonas:

1. **Barra superior (opcional):** búsqueda a la izquierda, filtros al centro y acciones a la derecha.
2. **Encabezado:** una celda por columna; las ordenables muestran un indicador de dirección.
3. **Cuerpo:** una fila por registro.
4. **Pie:** el rango mostrado a la izquierda, el selector de filas por página y los botones Anterior y Siguiente a la derecha.

### 6.2 Comportamiento obligatorio

- **Encabezado con ordenamiento**: solo en columnas marcadas como ordenables. Ciclo ascendente → descendente → sin orden. Indicador visual y atributo de accesibilidad del orden activo. El ordenamiento es **del servidor** y solo por campos indexados (regla del plan); cada columna declara su campo de orden y el contrato de la API lo valida.
- **Límite de objetos por página**: selector con valores fijos 10 · 25 · 50 · 100, por defecto 25. Ninguna tabla carga más de 100 filas.
- **Paginación en el pie**: botones "Anterior/Siguiente", rango visible y el selector de filas por página.
- **Paginación por cursor** (decisión del plan): el pie ofrece Anterior/Siguiente y no números de página ni salto a la página N. El componente guarda en memoria la pila de cursores para poder retroceder. Un total exacto solo se muestra si el endpoint lo entrega; no se calcula con desplazamiento numérico.
- **Listados de orden fijo** (sesiones, passkeys, roles e invitaciones pendientes): no ordenan ni buscan, así que su único estado es el tamaño de página, que vive en memoria (`useFixedOrderTable`, sobre `useTableQuery`) y no en la URL. Siempre se recargan al volver a la pantalla. El selector de invitar necesita todos los roles personalizados: recorre las páginas hasta agotar el cursor.
- **Pie siempre visible**: la tabla muestra el pie de paginación aunque haya una sola página (no existe forma de ocultarlo), porque los listados pueden crecer. Los listados que el servidor devuelve completos y sin cursor (comparticiones de una cuenta, credenciales de una cuenta e historial de versiones) se paginan en memoria con `useClientPagination` (`shared/lib`); si alguno llega a necesitar paginación del servidor, requiere un cambio de API.
- **Estado en la URL**: orden, dirección, límite, búsqueda y filtros viven en los parámetros de búsqueda del enrutador (validados con Zod). Así recargar o compartir el enlace conserva la vista. El cursor **no** va en la URL (caduca y no es compartible).
- **Estados**: cargando (esqueleto con las mismas columnas, sin saltos de layout), vacío (con acción sugerida), vacío por filtros (con botón "Limpiar filtros") y error (mensaje traducido del código de la API y "Reintentar").
- **Cambio de página sin parpadeo**: se conserva la página anterior mientras llega la siguiente, con un indicador de carga sutil.
- **Acciones por fila**: menú de "⋯" con teclado; las destructivas piden confirmación. Las acciones visibles dependen de los permisos del perfil, solo como comodidad.
- **Selección múltiple** (si el caso la exige): casilla por fila y en el encabezado, con contador y barra de acciones masivas.
- **Densidad única**: una sola altura de fila. Texto secundario en el color de apoyo; cifras tabulares.

### 6.3 Contrato del componente

La tabla es presentacional: no hace peticiones. Recibe estas entradas:

| Entrada | Descripción |
| --- | --- |
| Columnas | Lista de columnas. Cada una tiene identificador, encabezado ya traducido por el container, forma de pintar la celda, campo de orden opcional (si está presente, la columna es ordenable) y alineación al inicio o al final |
| Filas y su identificador | Los registros de la página actual y la forma de obtener un identificador único por fila |
| Estado | Cargando, correcto o error |
| Orden actual y aviso de cambio | Campo y dirección (ascendente o descendente), opcionales, y la función que se llama al cambiar |
| Límite y aviso de cambio | Uno de 10, 25, 50 o 100, y la función que se llama al cambiarlo |
| Paginación | Si hay página anterior, si hay siguiente, las acciones de ir a cada una y, opcionalmente, el total |
| Estado vacío | Contenido que se muestra cuando no hay filas |
| Estado de error | Mensaje y acción de reintento (opcional) |
| Acciones por fila | Menú opcional para cada fila |
| Leyenda | Obligatoria: describe la tabla para lectores de pantalla |

Un hook estándar de consulta de tablas, en `shared/api`, une la URL, el cursor y TanStack Query, de modo que cada pantalla solo declara columnas y endpoint.

### 6.4 Accesibilidad de la tabla

Marcado semántico de tabla con leyenda y encabezados con alcance, atributo de orden en el encabezado activo, navegación por teclado en encabezados y acciones, foco visible y anuncio del cambio de página en una región de anuncios educados para lectores de pantalla.

## 7. Datos, errores y sesión

### 7.1 Cliente HTTP

Un solo cliente en `shared/api`:

- Mismo origen, cookie de sesión `__Host-session`; sin tokens en JavaScript.
- Añade la cabecera personalizada exigida por la protección CSRF del plan en las peticiones que modifican.
- Genera una clave de idempotencia en las peticiones que crean recursos, estable ante reintentos.
- Envía la versión esperada del recurso en las modificaciones, para detectar conflictos.
- Convierte toda respuesta de error en un error tipado a partir de los detalles de problema (RFC 9457), con su `code` y el identificador de petición.

### 7.2 Tratamiento por código HTTP

| Estado | Comportamiento de la UI |
| --- | --- |
| `401` | Cierra el estado de sesión local y redirige al login conservando la ruta de retorno |
| `403` | Mensaje traducido según el `code`; no se reintenta |
| `403` por reautenticación requerida | Abre el diálogo de reautenticación; tras éxito, reintenta la acción una vez |
| `404` | Pantalla de "no encontrado" (no revela si existe) |
| `409` | Aviso de que el recurso cambió y opción de recargar (conflicto de versión) |
| `422` | Errores por campo en el formulario, desde la lista de campos inválidos |
| `429` | Aviso con el tiempo de espera; botón deshabilitado hasta entonces |
| `5xx` / red | Error genérico con el identificador de petición visible para soporte y "Reintentar" |

### 7.3 TanStack Query

- Cada feature construye sus claves de consulta con una fábrica propia; nunca cadenas sueltas.
- Las mutaciones invalidan por clave, no recargan la página.
- Cada tipo de dato declara explícitamente cuánto tiempo se considera fresco; los secretos revelados **no** pasan por la caché de Query (ver sección 9).
- Los errores esperados se manejan en el container; un contenedor de errores por ruta atrapa los inesperados.

## 8. Formularios

- `react-hook-form` + esquemas Zod de `packages/contracts`. El frontend no redefine validaciones del backend.
- El campo de formulario une etiqueta, control, ayuda y error con los atributos de accesibilidad correspondientes.
- Validación al enviar y, tras el primer error, al cambiar.
- Los errores `422` del servidor se mapean a campos del formulario.
- Botón de envío deshabilitado y en carga durante la mutación (evita doble envío).
- Los campos de contraseña usan el campo de contraseña del catálogo (mostrar y ocultar), con el autocompletado correcto; el medidor de fortaleza no envía la contraseña a terceros.

## 9. Seguridad en el navegador

Todo lo del plan, convertido en reglas verificables:

- **CSP estricta** definida por el backend: sin ejecución de código en línea ni evaluación dinámica; scripts solo del propio origen; sin incrustación en otros sitios; conexiones solo al propio origen. Por eso los estilos son clases de Tailwind (sin estilos en línea) y las fuentes se autoalojan.
- **`Permissions-Policy`** definida por el backend junto a la CSP (HDR-1): solo `display-capture=(self)` (alta de TOTP por captura de pestaña, ADR 0017); cámara, micrófono, geolocalización, pagos, USB, serie y Bluetooth se niegan. El alta con cámara (v1.1) abrirá `camera=(self)` en el mismo cambio que la construya.
- **Trusted Types activado.** Prohibido insertar HTML a mano y evaluar código dinámico (lint como error). Si alguna vez hace falta HTML, solo con una política de Trusted Types revisada.
- **Nada sensible en `localStorage`, `sessionStorage` ni IndexedDB.** Preferencias no sensibles (por ejemplo, filas por página) sí pueden usar `localStorage`, siempre con manejo de fallos.
- **Secretos revelados**: viven en el estado local del revelador de secretos, **nunca** en la caché de TanStack Query, en un contexto global ni en la URL. Se descartan al ocultar (30 s), al desmontar o al cerrar sesión. Las peticiones de revelación van con la cabecera de no almacenamiento en caché (backend) y la mutación se configura para no conservar resultados.
- **Alta de TOTP por imagen e importación de Google Authenticator** (`features/credentials`): la imagen se decodifica en el navegador y nunca se sube. Una exportación `otpauth-migration://` se lee con un decodificador de protobuf escrito a mano (sin dependencias, con límites de tamaño, de entradas y de longitud de texto; cualquier violación da un error sin contenido). Solo se importan cuentas TOTP que el servidor acepta (clave de al menos 128 bits, SHA1/SHA256/SHA512, 6 u 8 dígitos); las HOTP y las no compatibles se omiten y se cuentan en un aviso. Con una sola cuenta importable se usa igual que un QR normal; con varias, la persona elige una en un grupo de radios, porque cada credencial lleva un solo segundo factor. Las cuentas con sus secretos viven solo en el estado local del lector y se descartan al elegir, cancelar, leer otra imagen o desmontar.
- **Importación de credenciales por CSV** (`features/credentials`, ruta diferida `/credentials/import`): el archivo se revisa en el cliente (extensión `.csv` y 1 000 000 bytes) antes de leerlo con `File.text()`, así que uno enorme ni siquiera entra en memoria. El texto lleva contraseñas, por eso vive solo en una referencia del componente (no en un estado que se pinte, ni en Query, ni en la URL, ni en el almacenamiento) y se descarta al cancelar, al terminar, ante un error de la vista previa y al desmontar; las peticiones usan `useAsyncAction`, no `useMutation`, para que la caché de mutaciones no conserve el cuerpo. La vista previa solo muestra línea, plataforma, cuenta, etiqueta, estado y códigos (nunca usuario ni contraseña, aunque el servidor los devolviera: el esquema los descarta). Como el archivo admite 500 filas y ninguna tabla pinta más de 100, la tabla estándar se pagina en memoria con su pie habitual. «Importar» se habilita solo sin filas inválidas (la confirmación es todo o nada) y con al menos una fila válida; un 422 de la confirmación enumera las líneas rechazadas con su código traducido y bloquea reenviar el mismo archivo. Los errores de todo el archivo reutilizan los textos `CREDENTIAL_IMPORT.*` del catálogo de errores.
- **Códigos de recuperación** (`features/auth`, `RecoveryCodesPanel`): viven solo en el estado local del panel. «Descargar .txt» genera el archivo en el navegador (Blob y `URL.createObjectURL`, que se revoca con `URL.revokeObjectURL` tras un retardo corto de 5 s, también si el clic lanza, porque Firefox y Safari resuelven la descarga de forma asíncrona); el nombre es fijo (`recovery-codes.txt`) y el contenido lleva solo un encabezado genérico traducido, una advertencia de guardarlo en un lugar seguro y los códigos, uno por línea, sin correo, nombre ni fecha. No usa almacenamiento, caché de Query ni registros. Descargar no marca «Ya los guardé» ni desactiva el aviso al salir: la persona lo confirma.
- **Portapapeles**: al copiar un secreto se limpia a los 30 s (mejor esfuerzo, documentado en la UI).
- **Sesión**: cierre por inactividad sincronizado entre pestañas con un canal de difusión del navegador; al expirar se limpian estados sensibles.
- **Registros**: prohibido escribir en la consola respuestas de rutas sensibles; la regla de lint contra la consola es un error en producción.
- **Dependencias**: mismo control que el backend (versiones exactas, espera de 7 días, aprobación humana). Un paquete comprometido en la SPA ve todo lo que el usuario revela.
- **Enlaces externos**: se abren sin dar al destino acceso a la página de origen.

## 10. Internacionalización

- `i18next` con un espacio de nombres por feature (bóveda, directorio, autenticación y comunes). Claves semánticas (por ejemplo, el título de confirmación de la revelación), nunca el texto en inglés como clave.
- Idiomas: `es-MX` y `en-US`. El idioma se guarda en el perfil del usuario; la detección del navegador solo ocurre en el primer acceso.
- **Estado de la fase 0:** los catálogos son JSON planos con puntos literales en la clave y i18next se inicia sin separador de claves, de modo que la clave de un error de la API es el propio código. Las variables usan la interpolación nativa de i18next; ICU (`i18next-icu`) queda pendiente de aprobación como dependencia. La prueba de paridad también compara las variables de cada texto; la de «claves sin uso» aún no existe.
- Plurales y variables con ICU. Fechas, números y horas con `Intl` en la zona horaria del usuario (mediante utilidades de `shared/lib`; nadie formatea fechas directamente).
- Los códigos de error de la API se traducen con una clave derivada del código; si falta, se usa un mensaje genérico y se registra.
- **Prueba de CI**: falla si una clave existe en un idioma y no en el otro, o si hay claves sin uso.
- Los textos largos (el español suele ser ~20 % más largo) no deben romper el diseño: nada de anchos fijos en botones ni encabezados de tabla.
- Los textos de los catálogos viven junto a su feature; los comunes en `shared/i18n`.

## 11. Pruebas

| Tipo | Herramienta | Qué cubre |
| --- | --- | --- |
| Unitarias | Vitest | Modelo de cada feature, `shared/lib`, validaciones, formateo |
| Componentes | Vitest + Testing Library | Interacción accesible (por rol y etiqueta, no por clases) |
| Accesibilidad | `axe-core` directo con un ayudante propio (`vitest-axe` está desactualizado) | Cada componente de `shared/ui` y cada pantalla. jsdom no calcula estilos: la regla de contraste de color se desactiva en axe y la cubre la prueba de tokens |
| Tokens | Vitest | Contraste de los pares de la sección 4.2 |
| i18n | Vitest | Paridad de claves entre español e inglés |
| Arquitectura | `eslint-plugin-boundaries`, dependency-cruiser | Regla de dependencia (sección 3.2) |
| E2E | Playwright | Flujos críticos del plan (invitación, passkey, compartir, revelar, 2FA, baja) |

- Se prueban **comportamientos**, no implementación: se busca por rol, etiqueta o texto traducido, nunca por clase CSS.
- **Accesibilidad en navegador real:** `e2e/tests/wcag.spec.ts` ejecuta `@axe-core/playwright` en Chrome con las etiquetas `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` y `wcag22aa` sobre el inicio de sesión (anónimo), el directorio de usuarios, las cuentas, la seguridad y las credenciales de una cuenta, en inglés y en español (es-MX). A diferencia de jsdom, aquí sí se evalúa el contraste de color. Falla ante cualquier violación e imprime regla, impacto y selectores, sin HTML ni textos. No excluye reglas ni selectores: un falso positivo se reporta y se decide aparte.
- **Por qué no hay `eslint-plugin-jsx-a11y`:** no se instaló porque su rango de peer solo llega a ESLint 9 y el repositorio usa ESLint 10. La accesibilidad estática queda cubierta por las pruebas de componente con axe y por la comprobación e2e anterior.
- La tabla de datos tiene su propia suite: orden, límite, paginación por cursor, estados vacío, de error y de carga, y teclado.
- Las pruebas de secretos verifican que un valor revelado no queda en la caché de Query ni en el almacenamiento del navegador tras ocultarlo.

## 12. Rendimiento

- Partición de código **por ruta**; el login no descarga la bóveda.
- Presupuesto inicial de JavaScript (comprimido) a fijar en la fase 0 y vigilado en CI (propuesta de partida: 200 KB en la ruta de entrada). Un PR que lo supere explica por qué.
- Sin listas virtualizadas: la paginación del servidor acota las filas (máximo 100).
- Fuentes: un solo archivo variable por familia (Inter y JetBrains Mono), subconjunto latino y texto alternativo mientras cargan. Solo Inter se precarga; JetBrains Mono carga al necesitarse.
- Imágenes e íconos: SVG en línea mediante `lucide-react` (se importa solo lo usado, sin importar el paquete completo).

## 13. Accesibilidad

- Navegación completa por teclado; orden de tabulación lógico; sin trampas de foco (Radix gestiona el foco de diálogos y menús).
- Foco visible con el token de foco en **todos** los controles interactivos, nunca se elimina el contorno sin un sustituto.
- Todo control tiene nombre accesible; los botones con solo ícono llevan una etiqueta accesible traducida.
- Anuncios a lectores de pantalla para acciones como "Contraseña copiada" y cambios de página.
- Contraste AA verificado por la prueba de tokens.
- Respeta la preferencia de movimiento reducido: las transiciones se vuelven instantáneas.
- Áreas táctiles de al menos 24 × 24 px (WCAG 2.2, 2.5.8).

## 14. Convenciones de código

- Nombres en inglés en el código; comentarios y documentación en español. Los comentarios explican **por qué**, no qué.
- Componentes en PascalCase, hooks con el prefijo `use`, archivos en kebab-case. Un componente por archivo.
- Exportaciones nombradas (sin exportación por defecto), salvo lo que el enrutador exija. Cada feature y cada carpeta de `shared/ui` expone solo su archivo de entrada.
- Sin `any`; `unknown` y validación con Zod en los bordes de red. Identificadores con tipos de marca.
- Estado en el lugar más bajo posible: local → URL → Query → contexto. Sin store global salvo necesidad demostrada.
- Efectos secundarios solo para sincronizar con sistemas externos; no para derivar estado.
- TSDoc en los componentes de `shared/ui` y en las fachadas de los features.
- Funciones y componentes cortos: si un archivo pasa de ~200 líneas, es una señal para dividirlo (no una regla mecánica).
- Conventional Commits y PR pequeños, como el resto del monorepo.

## 15. Definición de terminado (frontend)

- [ ] Usa componentes de `shared/ui`; no hay tablas, botones ni campos hechos a mano.
- [ ] Sin colores, tamaños ni sombras literales; solo tokens.
- [ ] Claves i18n en `es-MX` y `en-US`; ningún texto literal.
- [ ] Teclado, foco visible y etiquetas verificados; prueba de accesibilidad en verde.
- [ ] Manejo de `401/403/404/409/422/429/5xx` según la sección 7.2.
- [ ] Las tablas usan la tabla estándar con orden, límite y paginación.
- [ ] Ningún secreto fuera del estado del componente.
- [ ] Lint, tipos, pruebas y límites de arquitectura en verde.
- [ ] Si toca rutas protegidas (CSP, autenticación), revisión doble.

## 16. Trabajo con agentes de frontend

Se puede apoyar el desarrollo del frontend en los agentes de Claude Code disponibles a nivel global. Son una ayuda para ejecutar, no una excepción a las reglas: **todo lo que produzcan debe cumplir esta guía**, y un humano revisa y se responsabiliza del resultado.

### Agentes y para qué sirven

| Agente | Úsalo para | Límites |
| --- | --- | --- |
| `frontend-developer` | Construir componentes de `shared/ui`, pantallas de un feature, formularios, tablas con la tabla estándar, pruebas de componente | Escribe código; necesita alcance de archivos explícito |
| `typescript-pro` | Tipos de marca, tipos genéricos de la tabla y de la consulta de tablas, cliente HTTP tipado, tipos derivados de `contracts` | Solo tipos y utilidades; no decide arquitectura |
| `ui-ux-designer` | Auditar accesibilidad, contraste, consistencia con los tokens y usabilidad de una pantalla o componente | Solo lectura; entrega hallazgos, no edita |

### Cómo delegar

1. **Apunta a la guía por referencia.** El encargo empieza con "lee `docs/frontend.md` antes de escribir" y nombra las secciones que aplican (por ejemplo, 5 y 6 para una tabla). No se parafrasean las reglas.
2. **Alcance explícito de archivos.** Lista las rutas que el agente puede crear o editar (por ejemplo, la carpeta del feature y la carpeta del organismo de tabla). Nada fuera de ellas.
3. **Un encargo, una unidad de comportamiento**: componente, prueba y claves i18n juntos. No se separan en agentes distintos código, pruebas y textos.
4. **Reutilizar antes de crear.** Debe usar los componentes y utilidades existentes (tabla estándar, campo de formulario, combinación de clases, consulta de tablas) y no volver a implementarlos. Si falta uno en el catálogo, lo propone antes de crear una variante.
5. **Criterios de aceptación en el encargo**: la lista de la sección 15 y el comando de verificación (lint, tipos y pruebas).
6. **Resultado:** el agente informa qué archivos tocó, qué comprobó y qué no pudo comprobar.

### Lo que los agentes no hacen

- **No agregan dependencias.** Si creen que hace falta una, la proponen y se detienen (regla del plan).
- **No tocan rutas protegidas** sin que un humano lo pida: CSP y cabeceras, autenticación y reautenticación, el revelador de secretos y todo lo que maneje secretos.
- **No leen archivos de entorno** ni datos de producción; no ejecutan comandos de red ni de despliegue.
- **No inventan estilos:** nada de colores, tamaños ni sombras literales; solo tokens.
- **No marcan como terminado** lo que no comprobaron.

### Revisión

- Todo código de agente pasa por revisión humana, como cualquier PR. En rutas protegidas se revisa línea por línea y con dos revisores; "las pruebas pasan" no es criterio suficiente.
- Las pruebas de comportamiento críticas (secretos fuera de la caché, tabla de datos, manejo de `403` por reautenticación) las escribe o las revisa una persona: si el mismo agente escribe el código y su prueba, puede repetir el mismo error en ambos.
- Para una revisión independiente de una pantalla terminada, se usa `ui-ux-designer` (solo lectura) y sus hallazgos se triagean antes de actuar sobre ellos.

## 17. Reglas de agente para `apps/web`

Las reglas que un agente debe respetar al trabajar en `apps/web` son estas. Si se publican como archivo de instrucciones propio de `apps/web`, deben coincidir con esta lista:

1. Sigue esta guía. Si algo no está cubierto, propónlo y detente.
2. Usa siempre componentes de `shared/ui`. Toda tabla es la tabla estándar.
3. Usa solo los tokens de diseño. Prohibido color, tamaño o sombra literal.
4. Ningún texto literal: claves i18n en `es-MX` y `en-US`.
5. Respeta la regla de dependencia: `shared` no importa `features`; entre features, solo por la fachada.
6. Prohibido insertar HTML a mano, evaluar código dinámico y escribir datos sensibles en la consola.
7. Los secretos solo en el estado local del componente; nunca en Query, contexto ni almacenamiento.
8. No agregues dependencias. Si crees que hace falta una, propónla y detente.
9. Nunca leas archivos de entorno ni datos de producción.
10. No toques rutas protegidas (CSP, autenticación, revelador de secretos) salvo encargo humano explícito.
11. Si trabajas como agente delegado, limítate a las rutas indicadas en el encargo.

Definición de terminado: pruebas de componente y de accesibilidad en verde; paridad de claves i18n, contraste de tokens y límites de arquitectura en verde.

## 18. Estado de las pantallas (fase 1a y bóveda de la fase 1b)

La web implementa las pantallas de la fase 1a (identidad) en `apps/web/src/features/auth`, `directory`, `security`, `sessions` y `roles`, y las de la bóveda (fase 1b, en curso) en `accounts`, `credentials` y `shares`, con las rutas definidas en `apps/web/src/app/router.tsx`:

| Pantalla o pieza | Dónde vive | Estado |
| --- | --- | --- |
| Ingreso con contraseña | `features/auth` (ruta pública de ingreso) | Funciona |
| Verificación en dos pasos (código de la aplicación o código de recuperación) | `features/auth` | Funciona |
| Registro del segundo factor (código QR y clave) y entrega única de los 10 códigos de recuperación | `features/auth` | Funciona |
| Aceptación de invitación (contraseña con indicador de fortaleza) | `features/auth` | Funciona |
| Directorio de personas con búsqueda, orden y paginación por cursor, y diálogo para invitar | `features/directory` | Funciona. Solo ofrece los rangos que quien invita puede crear; el diálogo incluye la elección opcional de "Responsable" (lista del subárbol de quien invita, activos y de rango superior al del invitado; por defecto, quien invita, y entonces no se envía `managerId`) y de "Roles" (roles personalizados). Una pestaña "Invitaciones" lista las pendientes (con las vencidas señaladas) y permite reenviar |
| Diálogo de reautenticación (abre ante el error de reautenticación requerida y reintenta la acción una vez) | `shared/auth` y `shared/api` | Funciona con el código de la aplicación o, si la persona tiene passkeys, con una passkey (`shared/auth/passkey-reauth.ts`; el diálogo la ofrece solo si la persona tiene alguna); no admite código de recuperación. La suite de Chrome cubre el flujo completo (cambiar rango, diálogo "Confirm your identity", código incorrecto rechazado y código correcto que completa la acción) |
| Cambio de contraseña (ruta `/password/change`; es obligatorio para la Raíz tras su primer ingreso con la contraseña inicial: mientras no se cambia, el ingreso lleva a esta pantalla y el registro del segundo factor se rechaza con `AUTH.PASSWORD_CHANGE_REQUIRED`) | `features/auth` | Funciona |
| Gestión de equipo (pestaña en la página de Usuarios, junto al directorio) con acciones por fila: suspender, reactivar, cambiar rango (con reautenticación), transferir responsable y desactivar (con diálogo de confirmación) | `features/directory` | Funciona. Lista el subárbol de quien consulta (la Raíz ve a todos) con su estado y su responsable |
| Cierre de sesión | `shared/auth` | Funciona |
| Botón "Use a passkey" en el paso de verificación del ingreso (aparece junto al código solo si la respuesta del ingreso indica que la persona tiene passkeys; comprueba el soporte del navegador) | `features/auth` | Funciona. Cubierto por una ceremonia real en Chrome con el autenticador virtual |
| Pantalla "Seguridad" (ruta `/security`, ruta diferida): lista las passkeys, permite agregar (con nombre) y quitar (ambas con reautenticación reciente); si el navegador no soporta WebAuthn, la pantalla lo explica | `features/security` | Funciona. Las respuestas nunca incluyen claves; máximo 10 por persona |
| Mis sesiones (ruta `/sessions`: lista con la sesión actual señalada y cierre de las demás) | `features/sessions` | Funciona |
| "Cerrar sesiones" en el menú de fila de la gestión de equipo | `features/directory` | Funciona |
| Sincronización entre pestañas (`BroadcastChannel`; el único mensaje es el nombre de un evento, nunca datos) | `shared/auth` | Funciona. Tras cerrar sesión o perderla, las otras pestañas del mismo navegador pasan al ingreso en cerca de un segundo |
| Pantalla de roles (ruta `/roles`: crear solo con los permisos propios de quien crea; editar nombre y permisos de un rol personalizado, con aviso y sin poder guardar si el rol incluye permisos que quien edita no tiene; archivar con confirmación) | `features/roles` | Funciona |
| Restablecer factores de otra persona | Sin implementar | Pendiente |
| Cuentas (ruta `/accounts`, ruta diferida): inventario y «Mis cuentas» en la tabla estándar; crear, editar y archivar cuentas con diálogo | `features/accounts` | Funciona |
| Credenciales de una cuenta (ruta `/accounts/$accountId/credentials`): tabla, alta, cambio de contraseña, revelado con motivo y reautenticación, y historial de versiones con «Restaurar» en las versiones anteriores (la vigente no lo ofrece) | `features/credentials` | Funciona |
| Segundo factor de una credencial: registro por clave manual o por imagen del QR (archivo, portapapeles o captura de pestaña), confirmación, código bajo demanda, exportar y retirar; admite la importación desde Google Authenticator | `features/credentials` | Funciona. Falta la entrega por celular |
| Compartición (ruta `/accounts/$accountId/shares`): tabla de accesos, diálogo para compartir y revocación con confirmación | `features/shares` | Funciona |
| Importación de credenciales por CSV (ruta `/credentials/import`, ruta diferida; enlace «Importar desde CSV» en Cuentas para quien tiene `account.create` y `credential.create`): elegir el archivo, previsualizar en la tabla estándar, confirmar y ver los conteos | `features/credentials` | Funciona (O2b, pruebas escritas sin ejecutar). Ver §9 para el manejo del texto del archivo |

**Diálogos de confirmación.** `ConfirmDialog` (`packages/ui/src/molecules/confirm-dialog.tsx`) tiene dos estados distintos: `loading` mientras la mutación corre (el botón de confirmar queda en carga, Cancelar se deshabilita y el diálogo **no se cierra** con Escape ni al hacer clic fuera) y `confirmDisabled`, que solo inhabilita la confirmación y deja Cancelar y Escape disponibles; se usa, por ejemplo, durante la espera por límite de peticiones.

**Espera por límite de peticiones (429).** Los diálogos de confirmación y los formularios de la bóveda y la gestión de personas usan `useRateLimitCooldown` (`shared/api`) con el error de la acción: mientras `secondsLeft > 0` no se reenvía y la alerta de error muestra la cuenta regresiva. Referencia: `features/shares/containers/revoke-share-dialog.tsx` (el controlador ignora la confirmación durante la espera); `features/credentials/containers/restore-version-dialog.tsx` y `features/sessions/containers/close-session-dialog.tsx` además pasan `confirmDisabled`.

El cliente HTTP envía una clave de idempotencia en las peticiones que crean recursos y el backend ya la aplica (ver [`backend.md`](backend.md) §7.2.1).

**Presupuesto de JavaScript.** El JavaScript inicial de la web mide cerca de 200,04 KB comprimido: 0,04 KB por encima de la propuesta de partida de 200 KB de la sección 12. El presupuesto no se hace cumplir y el exceso se justifica por la nueva ruta diferida y los hashes del catálogo.

**WebAuthn y el origen.** WebAuthn necesita un dominio, no una IP: el identificador de la parte confiable y el origen salen del origen de la aplicación (`APP_ORIGIN`), y la pila de pruebas e2e corre ahora en `localhost`.

Una prueba de web intermitente se corrigió esperando la consulta en lugar de afirmar justo después del encabezado: ante una prueba intermitente se arregla la espera, no se suben reintentos.

## 19. Decisiones pendientes

- [ ] **Registrar la aprobación de las dependencias** de la sección 2: ya están instaladas, pero su justificación (mantenimiento, licencia, alternativas) no consta en el repositorio.
- [ ] **Paginación**: confirmar el pie con Anterior/Siguiente por cursor. Si el equipo necesita números de página o salto a la página N, la API tendría que ofrecer paginación numérica en esos listados (contradice la regla actual del plan).
- [ ] **Presupuesto de JavaScript** inicial (sección 12): medido en cerca de 200,04 KB comprimido frente a la propuesta de 200 KB y todavía no se hace cumplir en CI; el equipo decide si lo fija y en qué valor.
- [ ] **Catálogo visual** (Storybook u otro): no incluido; se evalúa cuando existan ~15 componentes. Requiere aprobación como dependencia.
