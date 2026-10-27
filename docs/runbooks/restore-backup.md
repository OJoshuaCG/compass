# Runbook: Restaurar respaldo

> **Borrador, pendiente de ensayo antes de producción.** Los comandos de infraestructura están **por definir**. Un respaldo que nunca se restauró no es un respaldo (plan).

Referencias: [`plan.md`](../../plan.md) secciones "Respaldos y recuperación" y "Respaldo de claves"; criterio del gate de producción "simulacro de restauración exitoso".

## Objetivo

Reconstruir el sistema en un entorno aislado (simulacro) o de producción (recuperación real) a partir de PITR y snapshots, incluyendo **descifrar secretos con la KEK** para demostrar que la restauración es útil, no solo que la base arranca.

Objetivos iniciales del plan, a validar con el negocio: **RPO de 5 minutos** y **RTO de 4 horas**.

## Cuándo usarlo

- **Simulacro trimestral** de restauración completa en una cuenta aislada (plan).
- Recuperación real: corrupción de datos, pérdida de la base de datos o de una región, o restauración tras un incidente.
- Antes del gate de producción, como parte de su criterio.

## Precondiciones

- PITR con 35 días de retención y snapshots diarios copiados a otra región (configuración de infraestructura, por definir).
- Cuenta aislada disponible para el simulacro; los datos reales nunca salen de producción: en simulacro se restaura dentro de una cuenta aislada con el mismo nivel de control de acceso _(propuesto; validar con el equipo)_.
- Acceso autorizado a la KEK desde la cuenta de restauración (política del KMS por definir) y la KEK sin borrado programado (ventana de espera de 30 días).
- Sobres sellados de recuperación de cuentas críticas de plataforma disponibles si el sistema permanecerá caído.
- Autorización explícita de la Raíz y de un Administrador.

## Pasos

1. Declarar el simulacro o el incidente y fijar el punto de recuperación (momento del PITR o snapshot). Comando: por definir.
2. Restaurar la base de datos PostgreSQL al punto elegido en el entorno destino (red privada, TLS obligatorio, cifrado en reposo). Comando: por definir.
3. Aplicar las migraciones pendientes con el rol de migraciones, si el esquema difiere (proceso `migrate`). Comando: por definir.
4. Restaurar o reconstruir Redis (contadores y colas; no es fuente de verdad) y reinyectar los secretos de infraestructura desde el gestor de secretos. Comando: por definir.
5. Verificar el acceso a la KEK desde el entorno y desplegar la API y el worker con la configuración del entorno. Comando: por definir.
6. Ejecutar la verificación de la cadena de auditoría sobre los datos restaurados.
7. Descifrar un conjunto de secretos de prueba con la KEK (revelar una contraseña y generar un código 2FA de credenciales de verificación).
8. Medir y registrar RPO y RTO reales frente a los objetivos.
9. En simulacro: destruir el entorno aislado y los datos restaurados al terminar, y registrar el resultado. En recuperación real: cutover controlado y comunicación al equipo. Comando: por definir.

## Verificación

- La base restaurada tiene RLS activo y el rol de aplicación sin `BYPASSRLS`.
- La cadena de auditoría de cada organización verifica sin rupturas.
- Se descifran secretos con la KEK; si falla, la restauración **no** es válida.
- Las pruebas de aislamiento de tenants pasan sobre el entorno restaurado.
- RPO y RTO medidos están dentro de objetivos, o hay una desviación registrada y un plan de ajuste.

## Rollback

- En simulacro no hay producción que revertir: se descarta el entorno y se corrige el runbook.
- En recuperación real: conservar el estado dañado (snapshot) antes de reemplazarlo; si la restauración falla, repetir con otro punto de recuperación; si la KEK no está disponible, escalar de inmediato (la pérdida de la KEK implica la pérdida de los secretos) y activar el procedimiento de contingencia con los sobres sellados.

## Responsables

| Rol (propuesto) | Responsabilidad |
| --- | --- |
| Ingeniería de guardia | Ejecuta la restauración |
| Administrador | Verifica y firma el resultado |
| Raíz | Autoriza la restauración real o el simulacro |

## Historial de ensayos

| Fecha | Quién | Resultado | Cambios al runbook |
| --- | --- | --- | --- |
| (sin ensayar) | | | |
