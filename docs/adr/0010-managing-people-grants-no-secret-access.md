# ADR 0010: Gestionar personas no da acceso a secretos

- **Estado**: Aceptada
- **Fecha**: 2026-10-26
- **Referencias**: [`plan.md`](../../plan.md) sección "Gestionar personas no da acceso a secretos" y "Niveles de compartición".

## Contexto

Si la jerarquía diera acceso automático a las credenciales de los subordinados, cualquier cuenta de Administrador comprometida expondría todos los secretos de su subárbol, y no habría rastro de quién los vio.

## Decisión

Ningún rango concede acceso automático a credenciales. El acceso a un secreto existe solo por compartición explícita (USE, VIEW, EDIT, MANAGE) y auditada. Para que la Raíz conserve control total sin acceso silencioso, existe el **acceso de emergencia**: la Raíz y los Administradores con `vault.emergency_access` pueden concederse acceso VIEW a cualquier cuenta, con motivo escrito, reautenticación, duración de 1 hora, notificación a los gestores de la cuenta y evento de auditoría crítico. La Raíz y los Administradores con `vault.inventory.read` ven el inventario (metadatos, nunca secretos).

## Alternativas consideradas

- **Acceso heredado por jerarquía** _(inferida del plan)_: descartada por el radio de explosión y la falta de rastro.
- **Acceso permanente sin ceremonia para la Raíz**: descartado; el acceso de emergencia exige motivo, reautenticación y notificación.

## Consecuencias

- **Positivas**: el compromiso de una cuenta de gestión no abre secretos por sí mismo; todo acceso excepcional queda auditado.
- **Negativas o costos**: más fricción operativa (hay que compartir explícitamente); el flujo de emergencia debe estar bien ensayado.
- **Verificación**: pruebas de la matriz de autorización (paso 5 del motor de decisión: nivel efectivo); alerta crítica ante acceso de emergencia.
