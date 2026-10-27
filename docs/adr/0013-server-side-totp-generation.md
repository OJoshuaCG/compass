# ADR 0013: Códigos TOTP generados en el servidor; el secreto no sale

- **Estado**: Aceptada
- **Fecha**: 2026-10-26
- **Referencias**: [`plan.md`](../../plan.md) sección "2FA/TOTP: registro y generación de códigos"; [`docs/backend.md`](../backend.md) §10.

## Contexto

Un operador debe poder usar el 2FA de una cuenta de plataforma sin poder llevarse el secreto. Si el secreto viajara al navegador, quien tuviera nivel USE podría copiarlo y conservarlo.

## Decisión

El secreto TOTP se guarda cifrado (`SecretCipher`) y los códigos se generan en el servidor. El navegador recibe `{ code, expiresIn, nextCode? }` mediante `POST /credentials/:id/totp-code`, nunca el secreto. Requiere nivel USE y el permiso `credential.use_totp`, con rate limit por usuario y credencial y auditoría de cada código emitido. Exportar el secreto es una acción aparte que exige MANAGE, `credential.export_totp`, reautenticación y motivo, y genera un evento de auditoría crítico. Se usa `otplib`.

## Alternativas consideradas

- **Generar el código en el navegador**: descartada porque exigiría entregar el secreto al cliente.
- **Compartir el secreto como cualquier otro campo** _(inferida del plan)_: descartada porque USE no distinguiría "usar" de "poseer".

## Consecuencias

- **Positivas**: USE separa usar de poseer; la exportación queda excepcional y auditada.
- **Negativas o costos**: la hora del servidor es crítica (NTP y alerta de deriva mayor a 2 segundos); cada código emitido es una operación de descifrado sobre el camino caliente.
- **Verificación**: vectores de RFC 6238; pruebas de que ninguna respuesta de listado o detalle contiene el secreto.
