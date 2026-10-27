# Runbook: Responder a fuga de base de datos

> **Borrador, pendiente de ensayo antes de producción.** Los comandos de infraestructura están **por definir**.

Referencias: [`plan.md`](../../plan.md) sección "Respuesta a incidentes" ("Fuga de la base de datos sin el KMS") y "Cumplimiento"; [ADR 0004](../adr/0004-server-side-encryption-kms-per-org-dek.md).

## Objetivo

Contener y evaluar una fuga de la base de datos (copia, respaldo expuesto o acceso no autorizado). Si el atacante **no** tiene el KMS, los secretos siguen protegidos: están cifrados con una DEK que solo se abre con la KEK. Se rota la DEK por precaución y se revisan los accesos.

## Cuándo usarlo

- Sospecha o confirmación de que alguien obtuvo datos de PostgreSQL, un respaldo o un volcado.
- Alerta sobre acceso inusual a la base de datos o a snapshots.

Si además hay indicios de acceso al KMS o ejecución de código en el servidor, usa [servidor comprometido](compromised-user-or-server-response.md) en paralelo.

## Precondiciones

- Autorización de la Raíz y de un Administrador para actuar y para comunicar internamente.
- Acceso a los registros del proveedor de nube (acceso a la base de datos, a snapshots y uso del KMS). Consultas: por definir.
- Acceso al área legal y de privacidad: los correos de recuperación, nombres y registros de actividad son datos personales (plan, "Cumplimiento").

## Pasos

1. **Contener**: identificar el vector (credenciales de base de datos, snapshot compartido, acceso de red) y cerrarlo; rotar las credenciales de base de datos en el gestor de secretos. Comando: por definir.
2. **Determinar el alcance**: qué datos se copiaron y desde cuándo, usando los registros del proveedor de nube. Consultas: por definir.
3. **Determinar si el atacante tuvo acceso al KMS**: revisar el uso del KMS (`Decrypt`, `GenerateDataKey`) en los registros del proveedor. Si no hay indicios, los secretos siguen protegidos; si los hay, tratar como [servidor comprometido](compromised-user-or-server-response.md).
4. **Rotar la DEK por precaución** con el runbook [rotar DEK](rotate-dek.md).
5. **Revisar qué quedó expuesto en claro**: nombres, correos, `handle`, nombres de cuentas, etiquetas, comparticiones y metadatos de auditoría (no se cifran). Los secretos y los usuarios de plataformas van cifrados.
6. **Revisar accesos**: sesiones activas y auditoría reciente; revocar sesiones sospechosas. Considerar invalidar todas las sesiones.
7. **Verificar la cadena de auditoría** por si hubo manipulación.
8. **Notificar**: a la Raíz y a los Administradores, y a legal y privacidad para evaluar obligaciones de aviso. Plazos y contenido: por definir con el área legal.
9. **Cierre**: informe del incidente, acciones correctivas y actualización de [`threat-model.md`](../threat-model.md).

## Verificación

- El vector está cerrado y las credenciales expuestas fueron rotadas.
- La DEK nueva está activa y el recifrado terminó.
- No hay uso anómalo del KMS posterior al cierre.
- La cadena de auditoría verifica y no hay sesiones sospechosas activas.
- Legal y privacidad confirmaron el tratamiento de los datos personales expuestos.

## Rollback

No aplica revertir la fuga. Si una medida de contención causa una caída (por ejemplo, rotar credenciales de base de datos rompe el servicio), restaurar la credencial anterior solo si sigue siendo segura; de lo contrario, corregir hacia adelante con la nueva credencial. Si se invalidaron todas las sesiones, los usuarios inician sesión de nuevo con MFA.

## Responsables

| Rol (propuesto) | Responsabilidad |
| --- | --- |
| Ingeniería de guardia | Contención y análisis técnico |
| Administrador | Coordinación y verificación |
| Raíz | Decisiones de comunicación y escalamiento |
| Legal y privacidad | Obligaciones de aviso |

## Historial de ensayos

| Fecha | Quién | Resultado | Cambios al runbook |
| --- | --- | --- | --- |
| (sin ensayar) | | | |
