# Traspaso: cómo retomar el proyecto en otro equipo

Documento de continuidad. Responde a tres preguntas: **dónde estamos**, **cómo se retoma el trabajo en otra máquina o equipo** y **qué sigue, en qué orden y por qué**. Se actualiza al cerrar cada tarea grande (ver `odd/tasks/`).

## 1. Dónde estamos (resumen)

| Fase | Estado | Evidencia |
| --- | --- | --- |
| 0 · Fundaciones | Hecha | Monorepo, base de datos con aislamiento por organización, criptografía, auditoría, esqueleto de interfaz oscura bilingüe, ADR 0001 a 0024 |
| 1a · Identidad | **Hecha en lo esencial; faltan piezas** (sección 4, bloque A) | Invitación → contraseña → segundo factor obligatorio (TOTP) → sesión → reautenticación; matriz de jerarquía y 27 permisos; directorio; pantallas; pruebas de punta a punta incluso en navegador real |
| 1b · Bóveda y 2FA | No iniciada | Diseño de datos y cifrado ya listos (tablas, cifrado de secretos); falta toda la lógica de negocio y las pantallas |
| 1c · Gobernanza | No iniciada | La auditoría en cadena ya existe; faltan bajas con rotación, salud, acceso temporal y alertas |
| Puerta de producción | No iniciada | Exige prueba de penetración externa; **nada de esto debe cargar credenciales reales todavía** |
| 2 a 7 | No iniciadas | Ver el plan técnico |

Calidad verificada al cierre de este documento: formato, compilación, tipos y análisis estático en verde; 753 pruebas unitarias y de integración contra PostgreSQL real; 8 pruebas en Chrome real; dos revisiones adversariales ciegas (backend y frontend) aprobadas, y pruebas de mutación manual sobre lo crítico.

## 2. Qué NO está en el repositorio (y cómo recuperarlo)

| Elemento | Situación | Qué hacer |
| --- | --- | --- |
| **Remoto de git** | **No existe.** Todo el historial vive solo en la máquina original | Crear el repositorio remoto y subir `main` (decisión del equipo). Mientras tanto, existe una copia portátil: un archivo `iam.bundle` (ver sección 3) |
| Documento original del plan en Word | Sin versionar, solo en la máquina original | La versión viva es `plan.md`; el Word es la fuente del usuario |
| Reglas personales del autor (commits convencionales sin atribución de IA, respuestas breves, verificar antes de afirmar) | Viven en la configuración personal del autor, no en el repositorio | Están resumidas en `CLAUDE.md` y en la sección 6 de este documento |
| Registro de habilidades de las herramientas de IA | Generado automáticamente y ya excluido del repositorio | Se regenera solo; no importa |
| Clave local de pruebas del servicio de claves | Se crea sola al arrancar y está excluida del repositorio | No hay datos persistentes que recuperar: el entorno local es efímero |
| Secretos, contraseñas reales, datos de producción | **No existen.** Las únicas contraseñas son de prueba y están a la vista | Nada que migrar |

## 3. Cómo retomar en una máquina nueva

1. **Obtener el código.** Desde el remoto (cuando exista) o restaurando la copia portátil con `git clone iam.bundle iam`.
2. **Instalar requisitos:** Node.js 24 o superior, pnpm 10, Podman o Docker (las pruebas de integración levantan PostgreSQL real) y Google Chrome (las pruebas de navegador lo usan; no descargan navegadores).
3. **Si se usa Podman,** activar el socket de usuario y exportar las dos variables descritas en el `README.md` (apuntar a ese socket y desactivar el contenedor auxiliar de limpieza). Sin esto, las pruebas de integración no encuentran el motor de contenedores.
4. **Instalar dependencias:** `pnpm install`. Las versiones están fijadas y hay una espera de 7 días tras cada publicación: una dependencia muy reciente no se instalará (es intencional).
5. **Comprobar que todo está sano, en este orden:** `pnpm format:check`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test` y `pnpm e2e`. Si algo falla en una máquina limpia, es un defecto del traspaso: anótese en la sección 7.
6. **Probar a mano:** `pnpm stack` compila la API y la web, levanta PostgreSQL efímero, crea una organización con su Raíz y sirve la aplicación en `http://127.0.0.1:3100`. Imprime el correo y la contraseña de la Raíz; la primera vez hay que registrar el segundo factor con una aplicación autenticadora. El correo de las invitaciones no se envía: se lee en el buzón de pruebas que el comando indica.
7. **Leer, en este orden:** `docs/business/README.md` (qué hace el producto y por qué), `docs/business/roadmap-and-status.md` (estado por fase), este documento, `docs/architecture.md` y las guías `docs/backend.md`, `docs/frontend.md`, `docs/database.md`. El plan completo está en `plan.md`.

Para guardar una copia portátil del historial antes de mover el trabajo: `git bundle create iam.bundle --all`.

## 3 bis. Cómo se organiza el repositorio

| Carpeta | Contenido |
| --- | --- |
| `apps/api` | Servicio de backend por módulos (identidad, acceso, directorio, auditoría, criptografía, organización, notificación, aprovisionamiento) |
| `apps/web` | Aplicación web (pantallas de identidad y directorio) |
| `packages/ui`, `packages/i18n`, `packages/contracts`, `packages/config` | Componentes y tokens, textos en español e inglés, contratos compartidos, configuración común |
| `db` | Migraciones numeradas, ejecutor de migraciones y pruebas del esquema |
| `e2e` | Pruebas en navegador real y la pila local completa |
| `docs` | Documentación (negocio, guías de ingeniería, decisiones, amenazas, procedimientos) |
| `odd/tasks` | Seguimiento de cada tarea grande: especificaciones, tareas y bitácora |

## 4. Plan de continuación (en orden recomendado)

Tamaños relativos: **S** (días), **M** (una a dos semanas), **L** (varias semanas). El plan técnico no fija fechas; estimar cada bloque al empezarlo.

### Bloque A: cerrar la Fase 1a (antes de abrir la bóveda)

La bóveda depende de personas gestionables, de sesiones controlables y de un acceso fuerte. Por eso va primero.

| # | Tarea | Tamaño | Por qué ahora |
| --- | --- | --- | --- |
| A1 | **Gestión de personas:** cambiar rango, transferir responsable, suspender, desactivar con reasignación de subordinados, revocar sus sesiones al instante | M | Las reglas ya están escritas y probadas como datos; faltan los casos de uso, las pantallas y la baja. Sin esto no se puede ni suspender a alguien |
| A2 | **Passkeys (WebAuthn)** como método preferido; política de exigirlas a Raíz y Administradores | M | Criterio de salida de la 1a que hoy no se cumple. Probar con el autenticador virtual del navegador |
| A3 | **Alta de organizaciones como comando de operaciones**, con auditoría y códigos de emergencia de la Raíz | S | Hoy solo existe la capacidad interna y la usan las pruebas |
| A4 | **Cambio obligatorio de la contraseña inicial de la Raíz** | S | El indicador existe pero no se aplica; hoy esa contraseña vive indefinidamente |
| A5 | **Sesiones:** ver y cerrar las propias, cierre por el responsable, sincronización entre pestañas | S | Cierra requisitos del plan sobre sesiones |
| A6 | **Reenvío de invitación** (invalida la anterior) y **roles personalizados** (crear, asignar, límites de no escalamiento) desde la interfaz | M | Hoy la invitación vigente solo se puede esperar a que venza |
| A7 | **Idempotencia** de las peticiones que crean recursos | S | El cliente ya envía la clave; el servidor aún no la respeta |
| A8 | **Límites de intentos compartidos entre instancias** (Redis) y **correo real** (proveedor definido) | M | Hoy el bloqueo es por instancia y el correo solo se registra en desarrollo |
| A9 | **Ejecutar el CI en GitHub** y corregir lo que falle; añadir los escáneres de seguridad que pide el plan | S | Nunca ha corrido allí |
| A10 | **Reautenticación en navegador real** y reautenticación con código de recuperación | S | Se podrá probar cuando exista una acción sensible en la interfaz (A1 la aporta) |

### Bloque B: Fase 1b, bóveda y 2FA

1. Catálogo de plataformas y alta de cuentas y credenciales (M).
2. Cifrado y versionado de secretos con lo ya construido; revelación con reautenticación, motivo escrito y auditoría; ocultar a los 30 s (M).
3. Compartición por usuario y grupo con niveles de uso, ver, editar y gestionar; vista de acceso efectivo (M).
4. Los cinco métodos de registro del segundo factor y generación de códigos en el servidor (L; el más complejo: captura de pantalla, imagen, clave manual, celular, importación).
5. Importación desde archivo, búsqueda y vistas guardadas (S).

### Bloque C: Fase 1c y puerta de producción

Auditoría con pantalla, bajas con tareas de rotación, salud de credenciales, acceso temporal, alertas críticas (L). Después: prueba de penetración externa, simulacro de restauración y ensayo de los procedimientos. **No cargar credenciales reales antes.**

### Después

Fases 2 a 7 según `plan.md` (proveedor de inicio de sesión único, SAML, correos, SMS, extensión de navegador, broker). Cada una se abre cuando la anterior cumple sus criterios de salida.

## 5. Decisiones abiertas

**Del equipo (bloquean o condicionan; ya estaban en el plan):** proveedor de nube; escala del primer año; disponibilidad requerida; subdominio para los alias de cuentas; presupuesto de la prueba de penetración; política de retención; exigir passkeys a Raíz y Administradores; elegibilidad de Meta para la fase 3; custodios de los códigos de emergencia.

**Surgidas al construir (requieren criterio de negocio):**

| Tema | Hoy | Pregunta |
| --- | --- | --- |
| Permisos por defecto de Líder y Operador | El plan no los define; se asumió "todo lo que su rango puede tener" | Con eso un Operador puede revelar contraseñas y compartir por defecto. ¿Es lo deseado? |
| Responsable de la persona invitada | Siempre quien invita | El plan sugiere que quien invita lo define |
| Reautenticación | Solo acepta el código del autenticador | ¿Debe aceptar también un código de recuperación? |
| Directorio visible | Muestra nombre, correo y rango; solo personas activas | ¿Rango visible o solo nombre y correo? |
| Índice ciego derivado de la clave de datos | Cada rotación de clave obliga a recalcular los índices | ¿Derivarlo de una clave estable por organización? |
| ADR 0023 y 0024 (bloqueo de auditoría y retención) | Propuestos, sin decidir | Decidir antes de la bóveda |
| Versión de PostgreSQL | Pruebas con la 17 | ¿Pasar a la 18 (identificadores ordenables nativos)? |
| Proveedor de inicio de sesión único sobre Fastify | Sin probar | Hacer una prueba corta antes de la fase 2 |

## 6. Cómo se trabaja aquí (convenciones)

- **Método:** cada tarea grande tiene un documento en `odd/tasks/` con especificaciones (citando lo pedido), tareas y bitácora. Se trabaja en ciclos de implementar, ejecutar pruebas y corregir, **hasta 5 iteraciones** por tarea.
- **Revisión adversarial:** para código sensible (identidad, acceso, criptografía, auditoría, interfaz de sesión) se usan dos revisores ciegos con el mismo alcance congelado; solo se corrige lo que ambos confirman; hasta dos rondas de corrección y re-revisión. Complementa con **mutación manual**: romper a propósito la regla y comprobar que alguna prueba falla; si ninguna falla, la prueba no sirve.
- **Rutas protegidas** (identidad, acceso, criptografía, auditoría, migraciones con aislamiento, CSP y cabeceras, revelación de secretos): cambios solo por encargo humano explícito, con revisión doble.
- **Dependencias:** versión exacta, antigüedad mínima de 7 días y aprobación humana. TypeScript se mantiene en 6.0 (la 7 rompe el análisis estático) y todo el repositorio es ESM.
- **Commits:** convencionales, por parte terminada, **sin líneas de atribución a herramientas de IA**. No se sube nada al remoto sin decisión del equipo.
- **Documentación:** la de `docs/business` describe solo lógica de negocio, sin código; las guías de ingeniería explican reglas y decisiones sin pegar código.
- **Agentes:** funcionan bien los de documentación, base de datos, frontend, control de versiones y los dos revisores ciegos. Los revisores de la familia "review-*" **no sirven aquí** salvo con la herramienta nativa de revisión instalada.

## 7. Trampas conocidas del entorno

| Síntoma | Causa | Solución |
| --- | --- | --- |
| Las pruebas de integración no encuentran el motor de contenedores | Podman sin socket o variables sin exportar; Turborepo filtra el entorno | Variables del `README.md`; el repositorio ya las deja pasar en `turbo.json` |
| El análisis estático falla con TypeScript 7 | Aún no es compatible | No actualizar por encima de 6.0 |
| Un servidor Nest muere sin mensaje al arrancar | Por defecto aborta el proceso ante errores de inicio | Ya se desactivó: ahora falla con mensaje y código de salida |
| Las pruebas se cuelgan con muchas peticiones simultáneas | Agotamiento del pool de conexiones por transacciones anidadas | Las transacciones independientes usan un pool propio |
| Un código TOTP repetido se rechaza en las pruebas | Protección contra reutilización (intencional) | Generar códigos de pasos nuevos; esperar al siguiente paso si hace falta |
| Violación de CSP al abrir un diálogo | Una hoja de estilos fija de la biblioteca de diálogos | Permitida por hash exacto; si se actualiza la biblioteca, la prueba de navegador dará el hash nuevo |
| Pruebas de interfaz intermitentes bajo carga | Tiempos de espera por defecto muy ajustados | Ya ampliados; no volver a los valores por defecto |
| Terminar procesos con `pkill -f` mata la propia terminal | El patrón coincide con la línea de comandos | Usar el identificador exacto del proceso |
| Una dependencia recién publicada no se instala | Espera de 7 días (intencional) | Elegir una versión más antigua |

## 8. Deuda y riesgos conocidos

- El tamaño inicial del JavaScript del frontend (195 KB comprimido) está a 5 KB del presupuesto de 200 KB.
- El bloqueo de intentos y el límite por IP son por instancia hasta incorporar Redis.
- El correo es solo de desarrollo; sin proveedor real no hay avisos a las personas.
- La pantalla de inicio todavía muestra el texto del esqueleto de la fase 0.
- El módulo de aprovisionamiento no tiene punto de entrada fuera de las pruebas y de `pnpm stack`.
- No existe `.env.example`; las variables de configuración están documentadas en la configuración de la API (`apps/api/src/app/config.ts`).
- El CI de GitHub nunca se ha ejecutado y no incluye aún los escáneres de seguridad.

## 9. Mapa de documentación

| Pregunta | Documento |
| --- | --- |
| ¿Qué hace el producto y qué reglas aplica? | `docs/business/` |
| ¿Cómo está construido? | `docs/architecture.md`, `docs/backend.md`, `docs/frontend.md`, `docs/database.md` |
| ¿Por qué se decidió así? | `docs/adr/` (0001 a 0026) |
| ¿Qué amenazas se contemplan? | `docs/threat-model.md` |
| ¿Qué hacer ante un incidente? | `docs/runbooks/` (borradores, sin ensayar) |
| ¿Qué se hizo y qué se encontró en cada tarea? | `odd/tasks/` |
| ¿Qué sigue? | Este documento, sección 4 |
