# Runbook: Caída total con sobres sellados

> **Borrador, pendiente de ensayo antes de producción.** Casi todos los pasos de infraestructura siguen **por definir** (restauración, redes, equipo de guardia). No hay inventario ni política de los sobres sellados en el sistema: este documento solo fija el orden de las operaciones.

Referencias: [`plan.md`](../../plan.md) ("Respuesta a incidentes", "Recuperación"); [Restaurar respaldo](restore-backup.md); [Recuperar a la Raíz](recover-root.md); [ADR 0037](../adr/0037-root-recovery-dual-custody.md).

## Aclaración: qué son los sobres sellados

- **Sobres sellados de recuperación** (el plan): los códigos de recuperación de las **cuentas críticas de las plataformas** (correo corporativo, redes sociales, proveedores), guardados fuera del sistema, en papel, en sobre sellado. Permiten volver a entrar a esas plataformas cuando la bóveda no está disponible.
- **Códigos de emergencia de la Raíz** (ADR 0037): ocho códigos, cuatro por custodio (grupos A y B), también en papel. Sirven para recuperar la cuenta de la Raíz **dentro** del sistema.
- Son cosas distintas. El ADR 0037 usa la frase "sobres sellados" para el caso de los códigos de emergencia agotados; en este runbook ese caso se trata como parte de la caída total (paso 7).

## Objetivo

Volver a tener el sistema operando tras la pérdida de toda la plataforma (servidor, base de datos o ambos), sin depender de la propia bóveda para entrar a las plataformas necesarias para reconstruirla. Estado final: base restaurada y verificada, API arriba, la Raíz con acceso y las cuentas críticas recuperadas con los sobres.

## Cuándo usarlo

- La API y la base de datos no están disponibles y no se espera recuperarlas con un reinicio ni con un cambio de instancia.
- **No sirve** para una caída parcial: use primero [Operar con una sola instancia](single-instance-operation.md) y [Restaurar respaldo](restore-backup.md).
- **No sirve** si hay sospecha de fuga o intrusión: siga primero [Fuga de la base de datos](data-breach-response.md) o [Usuario o servidor comprometido](compromised-user-or-server-response.md); restaurar sobre un sistema comprometido reinstala el problema.

## Precondiciones

- Alguien con autoridad declaró la caída total y abrió el registro del incidente (hora, quién, alcance).
- **Equipo de guardia identificado** (por definir: C11 del `TODO.md`).
- Acceso al respaldo más reciente y a la **KEK** o a su clave en el KMS (ver [Pérdida o borrado de la KEK](kek-loss.md)). Sin ella, los secretos restaurados no se pueden abrir.
- Los sobres sellados accesibles físicamente y quienes pueden abrirlos (**por definir**: la política de quién los guarda, dónde y cada cuánto se revisan no existe; tampoco la lista de cuentas críticas).
- Los custodios A y B de la Raíz localizables, si se prevé recuperar a la Raíz (paso 6).

## Pasos

1. Declara la caída total, avisa a la Raíz y a los Administradores por un canal que **no dependa del sistema caído** (por definir).
2. Confirma que no hay intrusión (ver "Cuándo usarlo"). Si la hay, detén este runbook.
3. Restaura la base de datos y la infraestructura siguiendo [Restaurar respaldo](restore-backup.md) (comandos de infraestructura **por definir**). Objetivos del plan: pérdida máxima de 5 min y recuperación en 4 h, **ambas cifras sin validar** (C2 del `TODO.md`).
4. Antes de abrir el tráfico, arranca la API con la misma KEK (misma clave y versión) y comprueba que descifra: la verificación de [Restaurar respaldo](restore-backup.md) abre un secreto de prueba con su DEK.
5. Aplica las migraciones pendientes con el comando de la API (`node dist/main.migrate.js`) y comprueba la cadena de auditoría y el aislamiento por organización (comando de verificación **por definir**).
6. Si la Raíz no puede entrar (perdió contraseña o factores), sigue [Recuperar a la Raíz](recover-root.md) con los dos custodios.
7. Si **ya no quedan códigos de emergencia vigentes** de alguno de los dos grupos, el sistema no ofrece recuperación: escala a operaciones para la **administración directa de la base de datos** (procedimiento **por definir**; hoy no existe ni está ensayado) y registra la decisión de quien la autoriza.
8. Con el sistema arriba, abre los sobres sellados que hagan falta, **uno por vez y solo los necesarios**, y recupera las cuentas críticas de las plataformas. Anota cada sobre abierto (fecha, quién, motivo, testigo).
9. Cada sobre abierto queda **comprometido**: genera códigos nuevos en la plataforma, guárdalos en un sobre nuevo sellado y destruye el abierto.
10. Reabre el tráfico gradualmente y vigila la auditoría y las alertas. Cierra el incidente con un resumen (cuánto duró, qué se perdió) y abre las mejoras necesarias.

## Verificación

- La Raíz entra y los Administradores ven a sus equipos; una persona de prueba revela un secreto de prueba (descifrado correcto).
- La cadena de auditoría es continua hasta el último evento restaurado; lo perdido entre el último respaldo y la caída queda anotado.
- Cada sobre abierto tiene registro y un sobre de reemplazo sellado.
- Se midieron el tiempo real de recuperación y la pérdida real de datos, para validar o corregir los objetivos del plan.

## Rollback

- Si la restauración falla, no sobrescribas el respaldo usado: prueba con el anterior (35 días de recuperación a un punto en el tiempo según el plan) y anota la pérdida adicional.
- Un sobre abierto no se "cierra": se reemplaza (paso 9). No hay marcha atrás.
- Si la KEK no es recuperable, los secretos restaurados son ilegibles: pasa a [Pérdida o borrado de la KEK](kek-loss.md).

## Responsables

| Rol (propuesto) | Responsabilidad |
| --- | --- |
| Equipo de guardia (por definir) | Declara la caída, restaura y verifica |
| Custodios de sobres (por definir) | Entregan y registran cada sobre abierto |
| Custodios A y B de la Raíz | Participan en la recuperación de la Raíz |
| Raíz | Autoriza la administración directa de la base de datos, si hace falta |
| Administradores | Reciben el aviso y revisan la auditoría tras la restauración |

## Historial de ensayos

| Fecha | Quién | Resultado | Cambios al runbook |
| --- | --- | --- | --- |
| (sin ensayar) | | | |
