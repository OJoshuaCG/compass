# ADR 0026: Intentos fallidos contados de forma atómica

- **Estado**: Aceptada
- **Fecha**: 2026-10-27
- **Referencias**: [`plan.md`](../../plan.md) sección "Protección contra ataques"; [`docs/business/authentication.md`](../business/authentication.md) §6; [ADR 0015](0015-mandatory-mfa-passkeys-preferred.md).

## Contexto

El retraso progresivo y el bloqueo temporal tras intentos fallidos solo sirven si el límite no se puede esquivar. Si el sistema verifica la contraseña o el código y solo después cuenta el fallo, el orden deja una ventana. Una ráfaga de intentos simultáneos puede pasar toda la comprobación antes de que el primer fallo se registre: quien ataca prueba muchas claves en paralelo y el bloqueo llega tarde.

## Decisión

Cada intento se cuenta y se decide en una sola operación indivisible, antes de verificar nada: la operación registra el intento y devuelve si está permitido o bloqueado. Un intento bloqueado no se cuenta ni mueve la ventana, de modo que el bloqueo termina en su fecha. Un ingreso correcto reinicia el contador. La política (espera creciente desde el tercer intento fallido, bloqueo de 15 minutos tras 10, reinicio tras 15 minutos sin intentos) vive en el dominio y es la misma para el ingreso (contado por correo) y para el segundo factor (contado por usuario).

## Alternativas consideradas

- **Contar después de verificar**: permite ráfagas, como se describe en el contexto. Descartada.
- **Bloquear con una transacción de base de datos por intento** _(inferida del plan)_: serializaría los intentos de una persona, pero añade carga y contención a una ruta pública que ya es objetivo de ataques.

## Consecuencias

- **Positivas**: una ráfaga de intentos paralelos no puede superar el límite; la prueba de punta a punta comprueba que, de una ráfaga de códigos erróneos, se evalúan como máximo diez.
- **Negativas o costos**: el contador vive hoy en la memoria de cada instancia del servidor. Con varias instancias, cada una cuenta por separado, y un reinicio borra los contadores. Se sustituirá por un contador atómico en Redis (decisión pendiente, ver [`docs/backend.md`](../backend.md) §16), que lo hará global y duradero. El límite por dirección de red tiene la misma limitación.
- **Verificación**: pruebas del dominio de la política y prueba de punta a punta de la ráfaga paralela contra PostgreSQL real.
