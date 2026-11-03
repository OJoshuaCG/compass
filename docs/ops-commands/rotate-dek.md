# Comandos: rotar DEK (borrador)

Completa el runbook [rotate-dek](../runbooks/rotate-dek.md). Leyenda y advertencias en el [README](README.md).

**Casi todo ya existe.** El runbook trae los comandos de los pasos 2 y 4 (`POST /organization/data-key/rotate` y `pnpm --filter @iam/api reencrypt`, en producción `node dist/main.reencrypt.js`). Solo quedan dos líneas "por definir", y ninguna se resuelve escribiendo un comando.

| Línea del runbook | Estado | Qué falta de verdad |
| --- | --- | --- |
| Paso 7: destruir físicamente la versión `retired` | **Por definir** | Depende de la política de retención (C9, pendiente del dueño y de legal). No hay comando que escribir antes de esa decisión. |
| Rollback: "marcar la nueva versión como no usable y devolver la anterior a `active`" | **Por definir**, y es código que falta | No existe esa operación. Las versiones de DEK son inmutables ([ADR 0040](../adr/0040-dek-rotation-and-cache-coherence.md)), así que editar `data_keys` a mano contradice el diseño y toca criptografía (ruta protegida). Propuesta: tratar la operación "invalidar una versión recién creada" como parte de F4a, con su ADR y sus pruebas. |

## Cómo verificar que ya se puede retirar la versión anterior

No hace falta una consulta aparte: `reencrypt` imprime conteos y **sale con código 1 si quedó algún secreto en una versión anterior** o si falló una organización. Solo con código de salida 0 se puede dar por cerrada la verificación del paso 6.

## No verificado

- El encabezado del runbook dice que el recifrado de `credential_secrets` y de los traspasos TOTP sigue "por definir". `main.reencrypt.ts` ya usa `ReencryptSecrets`, `ReencryptTotpSecrets` y el recifrado de contraseñas de buzones, pero no leí qué tablas cubre cada uno. Hay que confirmarlo antes de dar por cierta cualquiera de las dos frases.
