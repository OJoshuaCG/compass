# ADR 0004: Cifrado del lado del servidor con KMS y DEK por organización

- **Estado**: Aceptada
- **Fecha**: 2026-10-26
- **Referencias**: [`plan.md`](../../plan.md) sección "Diseño criptográfico: KMS, cifrado de sobre y caché"; [`docs/backend.md`](../backend.md) §6.3 y §10.

## Contexto

El producto debe permitir compartir secretos, dar acceso de emergencia a la Raíz, recuperar acceso y (en fases futuras) leer códigos de correo y SMS. Un esquema de conocimiento cero (zero-knowledge) contradice todos esos requisitos porque el servidor no podría abrir los secretos.

## Decisión

Cifrado de sobre en el servidor con tres niveles de clave:

1. **KEK**: una clave simétrica en el KMS por organización, que nunca sale del KMS.
2. **DEK**: una clave de datos por organización y versión, guardada cifrada (`wrapped_dek`) en `data_keys`.
3. **Secreto**: cifrado con AES-256-GCM con la DEK activa, nonce aleatorio de 12 bytes y AAD `org_id | credential_id | field | version`.

Un único servicio, `SecretCipher`, en el módulo `crypto`, cifra y descifra; ningún otro módulo importa `node:crypto`. El KMS queda tras el puerto `KeyManagementPort`.

## Alternativas consideradas

- **Zero-knowledge (cifrado en el cliente)**: descartado explícitamente por el plan: contradice compartición, acceso de la Raíz, recuperación y lectura de correos.
- **Una sola clave global** _(inferida del plan)_: descartada porque rompería el aislamiento criptográfico por organización (capa 3 de [ADR 0006](0006-multitenancy-ready-rls.md)).

## Consecuencias

- **Positivas**: el costo del KMS no crece con el número de secretos; el AAD impide copiar texto cifrado entre credenciales; rotación de DEK sin tocar la KEK.
- **Negativas o costos**: si se pierde la KEK se pierden todos los secretos, lo que exige protección contra borrado, alertas y simulacros trimestrales de restauración; un servidor comprometido con acceso al KMS puede leer secretos (riesgo registrado en el plan).
- **Verificación**: vectores conocidos y pruebas negativas (AAD alterado, DEK incorrecta, texto truncado); lint `no-restricted-imports` para `node:crypto`; ver [runbook de rotación de DEK](../runbooks/rotate-dek.md).
