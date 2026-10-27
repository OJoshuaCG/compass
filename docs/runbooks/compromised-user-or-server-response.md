# Runbook: Responder a usuario o servidor comprometido

> **Borrador, pendiente de ensayo antes de producción.** Los comandos de infraestructura están **por definir**.

Referencias: [`plan.md`](../../plan.md) secciones "Respuesta a incidentes", "Bajas con rotación" y "Reautenticación"; [`threat-model.md`](../threat-model.md).

Este runbook cubre dos escenarios con pasos distintos. Elige la sección que aplica; pueden ejecutarse en paralelo.

## Objetivo

- **Usuario comprometido**: cortar su acceso, entender qué vio y rotar lo que reveló.
- **Servidor comprometido**: cortar el acceso del atacante a claves e infraestructura y rotar lo expuesto, evaluando una rotación masiva de credenciales de plataformas.

## Cuándo usarlo

- **Usuario**: señales de sesión robada, login desde dispositivo nuevo no reconocido, revelaciones o exportaciones anómalas, o aviso del propio usuario.
- **Servidor**: ejecución de código no autorizado, acceso anómalo al KMS, credenciales de infraestructura expuestas o imagen o dependencia comprometida.

## Precondiciones

- Autorización de la Raíz o de un Administrador (para suspender usuarios, el actor debe poder gestionarlo; ver regla de gestión del plan).
- Acceso a la auditoría y a los registros del proveedor de nube (consultas por definir).
- Para el escenario de servidor: acceso al gestor de secretos y al KMS con permisos de administración de incidentes (por definir).

## Pasos: usuario comprometido

1. **Suspender** al usuario (estado `suspended`); esto revoca sus sesiones en el acto. Si el atacante podría reactivar factores, también restablecer sus factores desde su responsable o la Raíz, con reautenticación y motivo.
2. **Revocar todas las sesiones** del usuario (el responsable puede cerrarlas todas).
3. **Revisar la auditoría** del usuario: revelaciones de contraseñas, códigos 2FA emitidos, exportaciones de secretos 2FA, comparticiones y cambios de rango o roles.
4. **Calcular la exposición**: credenciales cuya contraseña reveló y secretos 2FA que exportó (el mismo cálculo que `DeactivateUser`, con la ventana de auditoría de 180 días).
5. **Rotar todo lo que reveló**: crear tareas de rotación asignadas al gestor de cada cuenta y registrar nuevas versiones de los secretos; por exportación de 2FA, re-registrar el 2FA de la plataforma.
6. **Decidir** si procede la baja definitiva (`DeactivateUser`) o la reactivación tras restablecer factores con un nuevo flujo de invitación.
7. **Notificar** al usuario por un canal fuera de banda y a su responsable.

## Pasos: servidor comprometido

1. **Aislar** la instancia o tarea afectada y detener nuevas conexiones al KMS y a la base de datos desde ella. Comando: por definir.
2. **Rotar la DEK** (inmediata) con [rotar DEK](rotate-dek.md); la DEK en memoria del proceso comprometido debe considerarse expuesta.
3. **Rotar las credenciales de infraestructura**: base de datos, Redis y proveedores, desde el gestor de secretos. Comando: por definir.
4. **Revisar el uso del KMS** en los registros del proveedor: qué claves se usaron, desde qué rol y cuándo. Consultas: por definir.
5. **Revisar políticas de IAM** del servicio (solo el rol del servicio puede usar `Decrypt` y `GenerateDataKey`) y cerrar el vector de entrada (imagen, dependencia, configuración).
6. **Evaluar rotación masiva de credenciales de plataformas**: si hubo ejecución de código con acceso al KMS, los secretos descifrados deben considerarse expuestos. Priorizar las plataformas críticas; usar las tareas de rotación y los sobres sellados de recuperación si hay bloqueos.
7. **Desplegar** una imagen limpia y verificada; revisar el SBOM y el escaneo de la imagen.
8. **Verificar la cadena de auditoría** y revisar acciones del periodo comprometido.

## Verificación

- El usuario o la instancia comprometida no conserva sesiones, claves ni credenciales válidas.
- No hay uso anómalo del KMS tras la contención.
- La DEK nueva está activa; las tareas de rotación de credenciales expuestas existen, tienen responsable y avanzan.
- La cadena de auditoría verifica; el evento crítico del incidente está registrado.

## Rollback

- Una suspensión errónea se revierte reactivando al usuario (por quien lo gestiona), con revisión previa de la auditoría.
- Las rotaciones no se revierten: si una rotación rompe el servicio, corregir hacia adelante con las nuevas credenciales.
- Si el aislamiento de una instancia degrada la disponibilidad, escalar capacidad con instancias limpias antes de reabrir el tráfico.

## Responsables

| Rol (propuesto) | Responsabilidad |
| --- | --- |
| Ingeniería de guardia | Contención técnica, rotación, análisis |
| Administrador | Decisiones sobre usuarios, coordinación |
| Raíz | Escalamiento, comunicación, rotación masiva |
| Gestores de cuentas | Ejecutan las tareas de rotación de sus cuentas |

## Historial de ensayos

| Fecha | Quién | Resultado | Cambios al runbook |
| --- | --- | --- | --- |
| (sin ensayar) | | | |
