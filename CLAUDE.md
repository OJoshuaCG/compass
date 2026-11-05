# Compass: plataforma interna de identidad, accesos y bóveda

Guarda secretos reales de una empresa: ante la duda, la seguridad gana a la velocidad. El diseño completo está en `plan.md`; si algo lo contradice en seguridad, manda el plan. La fase 1b (bóveda) no está iniciada: no se carga ninguna credencial real hasta cerrar la fase 1 y pasar una prueba de penetración externa.

## Comandos (desde la raíz)

- Verificar todo, en este orden: `pnpm format:check`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Un solo paquete: `pnpm --filter <paquete> test`. En `@iam/api` hay `test:unit` (sin contenedores) y `test:integration`.
- Las pruebas de integración y `pnpm e2e` necesitan Podman o Docker. Con Podman exporta `DOCKER_HOST` apuntando al socket de usuario y `TESTCONTAINERS_RYUK_DISABLED=true`.
- `pnpm e2e` usa el Chrome instalado en el sistema y arranca la pila desde `apps/api/dist` y `apps/web/dist`: ejecuta `pnpm build` antes, o probará una versión vieja. `pnpm stack` levanta la plataforma completa en local para probar a mano.

## Dónde está la verdad

- Qué hace el producto y sus reglas: `docs/business/`. Léelo antes de cambiar una regla de negocio.
- Cómo se construye: `docs/backend.md`, `docs/frontend.md`, `docs/database.md`. Decisiones: `docs/adr/`.
- Estado, plan ordenado y decisiones abiertas: `docs/handoff.md`. Seguimiento de cada trabajo grande: `odd/tasks/`.
- Si una regla no está cubierta, propónla y pregunta como indica «Cómo preguntar». No improvises.

## Seguridad (no negociable)

- Todo acceso a datos pasa por el contexto de organización con aislamiento por filas. Nunca una consulta sin él.
- Toda acción sobre usuarios o bóveda la decide el motor de autorización del módulo de acceso; la guarda del controlador no es la autorización.
- Toda acción sensible escribe auditoría en la misma transacción. Las negaciones también se auditan.
- Solo el módulo de criptografía cifra, descifra o toca primitivas criptográficas.
- Nunca registres secretos, tokens, cookies ni cuerpos de rutas sensibles. En el navegador, los secretos viven solo en el estado local del componente que los muestra.
- Las migraciones aplicadas no se editan: crea una nueva. Toda tabla nueva lleva organización, índice y política de aislamiento en la misma migración.
- No leas `.env*`, secretos ni datos de producción. No ejecutes comandos de red ni de despliegue sin autorización expresa.
- Las reglas de capas e importaciones las hace cumplir el lint; no las desactives ni agregues excepciones.

## Rutas protegidas

Identidad, acceso, criptografía, auditoría, migraciones con aislamiento, CSP y cabeceras, y la revelación de secretos. No las modifiques sin encargo humano explícito; sí puedes revisarlas. Sus pruebas de autorización, criptografía y aislamiento las escribe o las revisa una persona.

## Convenciones

- Código e identificadores en inglés; comentarios y documentación en español. Los comentarios explican el porqué.
- `README.md` y `docs/business/` son para lectores humanos: sin código.
- Frontend: solo componentes y tokens del sistema de diseño, toda tabla usa la tabla estándar y ningún texto va literal (siempre es-MX y en-US).
- Dependencias: no agregues ninguna sin aprobación; versión exacta; se respeta la espera de 7 días. TypeScript se queda en 6.0 (la 7 rompe el lint) y todo el repositorio es ESM.
- Commits convencionales, por parte terminada, sin `Co-Authored-By` ni atribución a herramientas. Subir commits al remoto (`git push`) está permitido cuando la persona lo pide en el turno actual; nunca con `--force` ni hacia una rama distinta de la que se trabaja.
- Imita el código vecino y reutiliza antes de crear.

## Interfaz: sistema visual (ADR 0049)

Antes de crear o cambiar cualquier pantalla o componente lee `docs/frontend.md` §4.1 (reglas y tokens) y §17 (reglas para agentes). Si algo contradice esas reglas, manda el sistema visual, salvo en seguridad.

- Un solo acento latón («la aguja»): menú activo, botón principal, foco, valor revelado, progreso y el chip de la Raíz. No decora y no significa estado; la advertencia es naranja y distinta.
- Dos temas completos (oscuro y claro) con los mismos nombres de token. Solo utilidades semánticas (`bg-surface`, `text-text-secondary`, `border-border-strong`…): nunca un color literal, la paleta por defecto de Tailwind ni un color por tema escrito a mano.
- Cristal (`glass`, `glass-bar`) solo en capas flotantes: modales, barra superior y menús. Nunca en tarjetas ni tablas.
- El estado nunca va solo en color: texto más ícono o punto. Lo que debe leerse exacto (códigos, hashes, identificadores, marcas de tiempo, IP) va en `font-mono`.
- Pantallas nuevas: `PageHeader` con `eyebrow`, contenido en `Card`, rango con `RankBadge`, persona con `PersonCell`, tabla con la estándar. Reutiliza componentes de `@iam/ui` antes de crear uno.
- Un color nuevo se agrega en los dos temas, se mide el contraste en `apps/web/src/shared/styles/tokens.test.ts` y se documenta en §4.1 y §4.2 en el mismo cambio.
- Valores arbitrarios de Tailwind (`w-[37px]`, `opacity-85`…) prohibidos sin un comentario que explique el porqué.
- Los secretos revelados siguen sus reglas de Seguridad: opacos (`bg-raised`), `font-mono text-accent` y solo en el estado del componente que los muestra.

## Cómo trabajar

- En un trabajo grande, crea o actualiza su documento en `odd/tasks/` (especificaciones citando lo pedido, tareas y bitácora) y itera hasta 5 veces: implementar, probar, corregir.
- Código sensible: revisión adversarial con dos revisores ciegos (los agentes `jd-judge-a` y `jd-judge-b`) sobre el mismo alcance congelado; corrige solo lo que ambos confirman. Después rompe la regla a propósito y comprueba que alguna prueba falla. Los agentes `review-*` no funcionan en este entorno.
- Agentes de ejecución: `frontend-developer` (global) para interfaz (cada encargo le cita `docs/frontend.md` §4.1 y §17); para base de datos y documentación se delega a `general-purpose`, citando la skill `cognitive-doc-design` cuando el lector es humano. No tocan rutas protegidas ni agregan dependencias. Cada encargo nombra el documento que deben leer, las rutas que pueden editar y los criterios de aceptación.

## Autonomía: avanzar sin pedir permiso en cada paso

Esta sección es una autorización permanente de la persona dueña del proyecto. Cuenta como «el usuario aceptó» para las reglas globales que piden aprobar un plan, confirmar el alcance de un commit o pedir permiso para seguir.

- Si un trabajo ya tiene un plan aceptado o la persona dijo que siga, se ejecuta tarea tras tarea hasta terminar el lote. Un plan aceptado es un documento en `odd/tasks/`, una decisión en `docs/handoff.md` o un ADR aceptado. No se vuelve a proponer el plan ni se pregunta «¿sigo?» entre tareas o subtareas.
- Cada unidad terminada se commitea sin preguntar. Al agente `git` se le pasa la lista exacta de archivos de esa unidad como alcance ya aprobado.
- Se trabaja en `main`. No se crean ramas ni se pregunta por ellas.
- Solo se detiene el trabajo por algo de esta lista:
  - `git push`, resets, borrar datos o cualquier acción contra producción.
  - Una dependencia nueva, un comando de red o despliegue, o editar una migración ya aplicada.
  - Una ruta protegida que el encargo no incluye. Si el lote va a tocar rutas protegidas, se pide el encargo una sola vez al empezar, para todo el lote, no archivo por archivo.
  - Secretos o datos personales en el cambio.
  - Una regla de negocio que falta o es ambigua y que no está decidida en `docs/`.
  - La misma falla dos veces, una falla del entorno o una prueba que parece estar mal.
- Fuera de esa lista, ante una duda menor se elige la opción más conservadora y coherente con lo ya decidido, se anota en la bitácora del documento ODD y se sigue.

## Cómo preguntar

- Las preguntas se hacen aquí, en el chat. No se manda a la persona a leer un archivo para descubrir qué se le pregunta. El archivo puede guardar el detalle, pero la pregunta y lo necesario para responderla van en el mensaje.
- Cada pregunta va en lenguaje sencillo, sin tecnicismos, y trae:
  1. **Contexto:** qué se está haciendo y por qué salió la duda.
  2. **Escenario:** un ejemplo concreto de cuándo aplica.
  3. **Opciones e impacto:** qué se gana y qué se pierde con cada una, en seguridad, tiempo, costo o experiencia del usuario.
  4. **Recomendación:** cuál se sugiere y por qué.
  5. **La pregunta:** cerrada y fácil de contestar.
- Si hay varias preguntas que bloquean el mismo lote, van juntas en un solo mensaje y numeradas, para responderlas de una vez y seguir sin más pausas.

## Trampas del entorno

- No uses `pkill -f`: coincide con tu propia línea de comandos y cierra la terminal.
- Si una prueba es intermitente bajo carga, arregla la espera; no subas reintentos a ciegas.
- WebAuthn necesita un dominio, no una IP: el identificador de la parte confiable y el origen salen de `APP_ORIGIN`, por eso `pnpm stack` y el e2e corren en `localhost`.
- La configuración de la API se valida al arrancar (`apps/api/src/app/config.ts`; plantillas para una base de pruebas externa en `.env.example` y `.env.setup.example`, guía en `docs/deployment.md` §1.1) y producción exige `MAIL_TRANSPORT=smtp`. No pidas ni leas valores reales.
- Los contadores de intentos y el límite por IP viven en memoria hasta que haya Redis: asume una sola instancia de la API.

## Terminado significa

- Formato, compilación, tipos, lint y pruebas en verde; `pnpm e2e` también si cambió la interfaz o la API HTTP.
- Pruebas de la capa tocada: dominio; integración con base de datos real si toca repositorios; matriz de autorización si toca permisos; aislamiento si agrega tablas o listados; en la web, accesibilidad y textos en ambos idiomas. Detalle en `docs/backend.md` y `docs/frontend.md`.
