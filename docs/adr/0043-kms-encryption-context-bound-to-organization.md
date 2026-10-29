# ADR 0043: Contexto de cifrado del KMS ligado a la organización y control de usos anómalos

- **Estado**: Propuesta. Borrador de Ingeniería para `TODO.md` F5; no es una decisión hasta que una persona lo ratifique.
- **Fecha**: 2026-10-29
- **Referencias**: [ADR 0004](0004-server-side-encryption-kms-per-org-dek.md); [ADR 0005](0005-in-memory-dek-cache.md) (caché de DEK); [ADR 0020](0020-reference-cloud-aws.md) (adenda del adaptador de AWS); [ADR 0040](0040-dek-rotation-and-cache-coherence.md) (rotación); `apps/api/src/modules/crypto/infrastructure/aws-key-management.ts`; `apps/api/src/modules/crypto/application/ports/key-management-port.ts`; `db/migrations/0003_crypto_infra.sql`; `TODO.md` F5 y L1.

## Resumen

**Hallazgo principal:** la mitad del trabajo de F5 **ya está hecha en el código**. El adaptador de AWS envía `organization_id` como contexto de cifrado al generar y al abrir cada DEK. Lo que falta es del lado de AWS (política de la clave y alertas de CloudTrail) y decidir si el contexto debe llevar algo más.

**Recomendación (confianza media, alrededor de 70 %):** no cambiar el contexto (no se toca ningún texto cifrado) y poner el control en la política de la clave y en alertas de CloudTrail. Enriquecer el contexto se deja para cuando exista un uso concreto que lo justifique.

## Contexto

Verificado en el código:

- `AwsKeyManagement.encryptionContext()` devuelve `{ organization_id: <id> }` (`aws-key-management.ts` líneas 22 y 156 a 158). Lo usan `generateDataKey` (línea 76) y `decryptDataKey` (línea 117), y viaja en los comandos `GenerateDataKey` y `Decrypt` del SDK (líneas 185 y 200). La cabecera del archivo lo declara como invariante (líneas 4 a 5). El puerto lo repite en su comentario (`key-management-port.ts`).
- KMS autentica ese contexto: abrir una DEK envuelta para la organización A pidiendo el contexto de la B falla. Esto protege la separación entre organizaciones **dentro de KMS**, además del aislamiento por filas.
- La sonda de arranque (`verifyAccess`, líneas 138 a 154) usa el valor `startup-probe`, que no coincide con ninguna organización real. Lo dice el adenda del ADR 0020: si la política restringe `kms:EncryptionContext:organization_id` a organizaciones conocidas, hay que permitir también `startup-probe`.
- El contexto **no se guarda**: `data_keys` guarda `wrapped_dek` y `kms_key_ref` (migración 0003) pero no la forma del contexto. Hoy toda fila usa la misma forma, así que no hace falta.
- La versión de la DEK **no** forma parte del contexto: todas las versiones de una organización se envuelven con el mismo `{ organization_id }`.
- KMS se llama solo cuando la DEK no está en la caché (TTL de 10 minutos, ADR 0005), al generar una versión nueva (rotación, ADR 0040) y en la sonda de arranque. Por eso el volumen normal de llamadas es bajo y una línea base de "uso normal" es práctica.
- Una sola clave de plataforma envuelve las DEK de todas las organizaciones (adenda del ADR 0020).

Qué aporta y qué no aporta el contexto:

| Pregunta | Respuesta |
| --- | --- |
| ¿Impide que una aplicación comprometida abra la DEK de otra organización? | **No.** La aplicación decide qué organización pide; el contexto lo escribe ella misma. |
| ¿Impide copiar un `wrapped_dek` de una organización a otra y abrirlo? | **Sí**, KMS lo rechaza. |
| ¿Permite ver en CloudTrail para qué organización se abrió cada DEK? | **Sí**, si el contexto se registra (CloudTrail guarda el contexto de cifrado de estas llamadas; no verificado contra una cuenta real). |
| ¿Permite limitar por política qué organizaciones puede abrir el rol? | Sí, con condiciones sobre el contexto, con el costo operativo que se describe abajo. |

## Opciones

### A. Mantener el contexto actual y controlar en la política y en CloudTrail (recomendada)

- **Código**: sin cambios. Los textos cifrados y las DEK envueltas existentes siguen abriéndose.
- **Política de la clave y del rol IAM**:
  - Exigir que toda llamada traiga la clave `organization_id` en el contexto (condición de presencia de claves de contexto). No necesita listar organizaciones y no rompe la sonda, cuyo contexto también tiene esa clave.
  - Limitar el rol a `kms:GenerateDataKey` y `kms:Decrypt` sobre esa única clave (ya lo pide `docs/deployment.md`).
- **Alertas de CloudTrail** (propuestas): llamadas sin la clave `organization_id`; valores que no son un UUID de organización conocida ni `startup-probe`; `startup-probe` fuera de un reinicio o despliegue; volumen de `Decrypt` por organización muy por encima de la línea base; llamadas desde una dirección o un principal que no sea el servidor.
- **A favor**: sin riesgo para datos existentes; cumple la intención de F5.
- **En contra**: depende de operar CloudTrail y alertas, que hoy no existen; la lista de organizaciones permitidas no está en la política.

### B. Enriquecer el contexto solo para las DEK nuevas

- **Cómo sería**: por ejemplo agregar un propósito fijo (`dek-wrap`) y el entorno, y guardar en `data_keys` qué forma de contexto usa cada fila para abrir las antiguas con la suya. Las versiones nuevas (por rotación, ADR 0040) usan la forma nueva.
- **A favor**: CloudTrail distinguiría el propósito y el entorno; deja una vía de evolución.
- **En contra**: requiere una migración en `data_keys` (ruta protegida) y código de selección de forma. Hoy solo hay **un propósito** (envolver DEK) y claves distintas por entorno, así que el beneficio inmediato es nulo.

### C. Enriquecer y re-envolver todas las DEK existentes

- **Cómo sería**: KMS puede re-envolver una DEK con otro contexto sin que la DEK salga del servicio (`ReEncrypt`, con contexto de origen y de destino; no verificado contra una cuenta real). Requiere permisos adicionales y una ventana de coordinación con la rotación.
- **A favor**: una sola forma de contexto en toda la tabla.
- **En contra**: toca todas las DEK de producción y la clave que protege todo; el riesgo es desproporcionado para un beneficio que A ya da.

### Variante de A: lista cerrada de organizaciones en la política

Condicionar `Decrypt` a los identificadores de las organizaciones existentes (más `startup-probe`). **A favor**: un valor desconocido se rechaza en KMS y no solo se alerta. **En contra**: dar de alta una organización exige actualizar antes la política de la clave (un paso manual más en [`provision-organization.md`](../runbooks/provision-organization.md), con la clave de más valor del sistema). Con menos de 20 clientes es viable, pero es un cambio de proceso, no de código.

## Recomendación (propuesta)

Opción A, y decidir aparte la variante de lista cerrada. Dejar B y C documentadas para cuando aparezca un segundo uso de KMS (por ejemplo la firma del ADR 0042 o claves de otros módulos) que sí necesite distinguir propósito.

Interacciones:

- **Rotación (ADR 0040)**: la rotación sigue generando versiones nuevas con el mismo contexto; no cambia nada. Si algún día se adopta B, los textos cifrados con DEK antiguas siguen abriéndose mientras la fila guarde su forma de contexto, y la destrucción de versiones viejas (C9) no se ve afectada.
- **Recifrado**: el contexto es de la **DEK envuelta**, no de cada secreto; el recifrado de secretos (que usa AAD propio) no cambia.
- **Sonda de arranque**: con A no requiere cambios. Con la variante de lista cerrada, hay que permitir `startup-probe`.

## Consecuencias (si se acepta)

- **Positivas**: sin riesgo para datos cifrados; F5 se cierra con configuración de AWS y de observabilidad, no con una migración.
- **Negativas o costos**: la eficacia depende de que alguien reciba y atienda las alertas; la política no impide por sí sola que una aplicación comprometida abra la DEK de cualquier organización (ver tabla).
- **Verificación**: las pruebas del adaptador ya comprueban que el contexto enviado es `{ organization_id }`, también en la sonda (`aws-key-management.test.ts` líneas 79, 151, 221 y 222, 318 a 326); lista de comprobación del despliegue que valide la política y las alertas; ensayo en el que una llamada con contexto inválido debe aparecer en CloudTrail y disparar la alerta. Pendiente: la prueba contra AWS real que ya anota L1.

## Preguntas abiertas para una persona

1. **¿Lista cerrada de organizaciones en la política de la clave (variante de A) o solo alertas?** Es la decisión de fondo: seguridad adicional frente a un paso manual más al crear organizaciones.
2. ¿Quién atiende las alertas de CloudTrail y con qué canal? Hoy no hay observabilidad definida para esto.
3. ¿Se admite que la cuenta de AWS y CloudTrail se configuren fuera del repositorio (infraestructura manual) o se necesita un documento de configuración versionado?

## No verificado

- Que CloudTrail registre el contexto de cifrado de `Decrypt` y `GenerateDataKey` con el detalle supuesto, y los nombres exactos de las condiciones de política (se redactan de memoria de la documentación de AWS).
- El comportamiento de `ReEncrypt` y los permisos que exige.
- Nada de lo anterior se probó contra AWS real: las pruebas del adaptador usan un cliente simulado (L1).
