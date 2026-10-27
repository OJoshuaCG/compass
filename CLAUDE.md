# Plataforma interna de identidad, accesos y bóveda

Guarda secretos reales de una empresa: ante la duda, la seguridad gana a la velocidad. El diseño completo está en `plan.md`; si algo lo contradice en seguridad, manda el plan.

## Comandos (desde la raíz)

- Verificar todo, en este orden: `pnpm format:check`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Un solo paquete: `pnpm --filter <paquete> test`. En `@iam/api` hay `test:unit` (sin contenedores) y `test:integration`.
- Las pruebas de integración y `pnpm e2e` necesitan Podman o Docker. Con Podman exporta `DOCKER_HOST` apuntando al socket de usuario y `TESTCONTAINERS_RYUK_DISABLED=true`.
- `pnpm e2e` usa el Chrome instalado en el sistema. `pnpm stack` levanta la plataforma completa en local para probar a mano.

## Dónde está la verdad

- Qué hace el producto y sus reglas: `docs/business/`. Léelo antes de cambiar una regla de negocio.
- Cómo se construye: `docs/backend.md`, `docs/frontend.md`, `docs/database.md`. Decisiones: `docs/adr/`.
- Estado, plan ordenado y decisiones abiertas: `docs/handoff.md`. Seguimiento de cada trabajo grande: `odd/tasks/`.
- Si una regla no está cubierta, propónla y detente. No improvises.

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
- Commits convencionales, por parte terminada, sin `Co-Authored-By` ni atribución a herramientas. No subas nada al remoto sin decisión del equipo.
- Imita el código vecino y reutiliza antes de crear.

## Cómo trabajar

- En un trabajo grande, crea o actualiza su documento en `odd/tasks/` (especificaciones citando lo pedido, tareas y bitácora) y itera hasta 5 veces: implementar, probar, corregir.
- Código sensible: revisión adversarial con dos revisores ciegos (los agentes `jd-judge-a` y `jd-judge-b`) sobre el mismo alcance congelado; corrige solo lo que ambos confirman. Después rompe la regla a propósito y comprueba que alguna prueba falla. Los agentes `review-*` no funcionan en este entorno.
- Agentes de ejecución: `documentation-expert`, `database-architect`, `frontend-developer`. No tocan rutas protegidas ni agregan dependencias. Cada encargo nombra el documento que deben leer, las rutas que pueden editar y los criterios de aceptación.

## Trampas del entorno

- No uses `pkill -f`: coincide con tu propia línea de comandos y cierra la terminal.
- Si una prueba es intermitente bajo carga, arregla la espera; no subas reintentos a ciegas.

## Terminado significa

- Formato, compilación, tipos, lint y pruebas en verde; `pnpm e2e` también si cambió la interfaz o la API HTTP.
- Pruebas de la capa tocada: dominio; integración con base de datos real si toca repositorios; matriz de autorización si toca permisos; aislamiento si agrega tablas o listados; en la web, accesibilidad y textos en ambos idiomas. Detalle en `docs/backend.md` y `docs/frontend.md`.
