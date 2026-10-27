# Plataforma interna de identidad, accesos y bóveda

Una herramienta interna para que un equipo pequeño gestione **quién puede entrar a qué**, y para guardar y compartir de forma segura las **cuentas de plataformas externas** (por ejemplo, redes sociales) con sus segundos factores de verificación. Cada acceso importante queda registrado en una bitácora que nadie puede reescribir.

Está pensada para una sola organización de unas tres personas operando, aunque el diseño ya permite crecer a varias. Guarda secretos reales de la empresa, así que en cada decisión **la seguridad pesa más que la velocidad**.

## Qué resuelve

- **Personas y jerarquía.** Cuatro niveles (Raíz, Administrador, Líder y Operador). Cada persona solo gestiona a quien está por debajo de ella en su propia línea de responsabilidad.
- **Entrada segura.** Nadie se registra por su cuenta: se entra por invitación, con contraseña y un segundo factor obligatorio.
- **Bóveda compartida.** Las credenciales se comparten con niveles de acceso claros (usar, ver, editar, gestionar) y los secretos viven cifrados.
- **Segundo factor centralizado.** Un operador puede usar el código de una cuenta sin llegar a conocer el secreto que lo genera.
- **Registro a prueba de manipulación.** Quién hizo qué, cuándo y con qué resultado, incluidas las acciones que se negaron.
- **Salida ordenada.** Cuando alguien deja el equipo, se cierra su acceso y se señalan los secretos que conoció para cambiarlos.

## En qué punto está

| Fase | Qué entrega | Estado |
| --- | --- | --- |
| 0 · Fundaciones | Base técnica, base de datos con aislamiento por organización, cifrado, registro y diseño visual | Terminada |
| 1a · Identidad | Invitaciones, contraseña, segundo factor, sesiones, permisos y directorio de personas | **Funciona; faltan piezas** (llaves de acceso, códigos de emergencia de la Raíz, que esperan una decisión del equipo, almacén compartido de contadores, correo real y la ejecución del CI en GitHub). Ya incluye la gestión de personas, el cambio obligatorio de la contraseña inicial, la gestión de sesiones, los roles personalizados con reenvío de invitaciones y la idempotencia de las peticiones de creación |
| 1b · Bóveda y segundo factor | Guardar y compartir cuentas, revelar contraseñas con motivo y generar códigos | Pendiente |
| 1c · Gobernanza | Pantalla de auditoría, bajas con rotación, salud de credenciales y acceso temporal | Pendiente |
| 2 a 7 | Inicio de sesión único, lectura de correos y SMS, extensión de navegador y broker | Pendientes |

**Todavía no debe cargarse ninguna credencial real.** Antes hace falta terminar la fase 1 y pasar una prueba de penetración externa.

## Requisitos

| Necesitas | Versión | Para qué |
| --- | --- | --- |
| Node.js | 24 o superior | Ejecutar y construir el proyecto |
| pnpm | 10 | Instalar dependencias y lanzar las tareas |
| Podman o Docker | Cualquiera reciente | Levantar una base de datos de pruebas y el entorno local |
| Google Chrome | Reciente, instalado en el sistema | Pruebas en navegador real (no se descarga ningún navegador) |
| Aplicación autenticadora | Cualquiera compatible | Para registrar tu segundo factor al probar a mano |

Sistema probado: Linux. Cuenta con unos 4 GB de memoria libres y conexión a internet la primera vez (se descargan dependencias e imágenes).

## Primeros pasos

1. **Obtén el código** y entra en la carpeta del proyecto.
2. **Instala las dependencias** con `pnpm install`.
3. **Si usas Podman** (con Docker no hace falta nada), activa su servicio de usuario con `systemctl --user enable --now podman.socket` y define dos variables de entorno antes de lanzar las pruebas: `DOCKER_HOST` con la dirección del servicio de Podman de tu usuario (`unix:///run/user/<tu id>/podman/podman.sock`) y `TESTCONTAINERS_RYUK_DISABLED` con el valor `true` (desactiva un contenedor de limpieza que Podman sin privilegios no admite).
4. **Comprueba que todo funciona** con `pnpm build` y luego `pnpm test`. Si ambos terminan sin errores, el entorno está listo.
5. **Pruébalo a mano** con `pnpm stack`. Compila la plataforma, levanta una base de datos temporal, crea una organización de ejemplo y te muestra la dirección, el correo y la contraseña de la persona Raíz. Los datos se borran al detenerlo.

### Probarlo como usuario

1. Abre la dirección que imprimió `pnpm stack` y entra con el correo y la contraseña de la Raíz.
2. El sistema te pide cambiar la contraseña inicial: escribe la actual y elige una nueva.
3. Registra el segundo factor: escanea el código QR con tu aplicación autenticadora y escribe el código de seis dígitos. Guarda los diez códigos de recuperación que se muestran **una sola vez**.
4. Entra a **Usuarios** e invita a alguien. El correo no se envía de verdad: el entorno local publica el último mensaje en un buzón de pruebas cuya dirección también imprime `pnpm stack`.
5. Abre el enlace de la invitación en otra ventana privada, elige una contraseña y registra su segundo factor.
6. De vuelta como Raíz, abre la pestaña de gestión de equipo en **Usuarios** para suspender, reactivar, cambiar el rango, transferir o desactivar a la persona invitada.

### Otras tareas habituales

| Quiero | Comando |
| --- | --- |
| Verificar formato, tipos y reglas de estilo | `pnpm format:check`, `pnpm typecheck`, `pnpm lint` |
| Ejecutar las pruebas del sistema | `pnpm test` |
| Ejecutar las pruebas en navegador real | `pnpm e2e` |
| Trabajar solo en la interfaz web con recarga en vivo | `pnpm --filter @iam/web dev` |
| Dar de alta una organización con su Raíz (operaciones) | `pnpm --filter @iam/api provision` |

## Cómo está organizado

| Carpeta | Qué contiene |
| --- | --- |
| `apps/api` | El servicio principal (reglas de negocio, seguridad y acceso a datos) |
| `apps/web` | La aplicación web |
| `packages` | Piezas compartidas: componentes visuales, textos en español e inglés, contratos entre servicio y web, configuración común |
| `db` | Las migraciones de la base de datos y sus pruebas |
| `e2e` | Pruebas en navegador real y el entorno local completo |
| `docs` | Toda la documentación |
| `odd` | Seguimiento de cada trabajo grande: qué se pidió, qué se hizo y qué se encontró |

## Dónde leer más

| Si quieres... | Lee |
| --- | --- |
| Retomar el proyecto en otro equipo | [`docs/handoff.md`](docs/handoff.md) |
| Entender qué hace el producto y qué reglas aplica | [`docs/business/`](docs/business/README.md) |
| Ver el diseño completo y las decisiones | [`plan.md`](plan.md) y [`docs/adr/`](docs/adr/README.md) |
| Entender cómo encajan las piezas | [`docs/architecture.md`](docs/architecture.md) |
| Conocer las amenazas contempladas | [`docs/threat-model.md`](docs/threat-model.md) |
| Saber qué hacer ante un incidente | [`docs/runbooks/`](docs/runbooks/README.md) |
| Ver todo el índice | [`docs/README.md`](docs/README.md) |

## Cómo se colabora

- Los cambios se hacen en pasos pequeños, con mensajes de commit en el formato convencional y revisión de una persona. Lo que toca identidad, permisos, cifrado, auditoría o el aislamiento de datos requiere dos revisores.
- No se agregan dependencias sin aprobación humana.
- El código y los nombres técnicos están en inglés; los comentarios y la documentación, en español.
- Las reglas para trabajar con asistentes de inteligencia artificial están en [`CLAUDE.md`](CLAUDE.md).

## Seguridad

Nunca se guardan secretos en el repositorio ni en los registros. Los hallazgos de seguridad se comunican por un canal privado a las personas responsables del proyecto (canal por definir antes de producción).
