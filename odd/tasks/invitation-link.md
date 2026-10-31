# Enlace de invitación visible para quien invita

Estado: **en curso** (2026-10-30). Ruta protegida (identidad, acceso, migración con permisos de roles): requiere revisión humana de las pruebas SENSIBLE, jueces ciegos y prueba de mutación.

## Especificación

Pedido textual del dueño: "Al invitar un usuario nuevo, ¿envía un correo? ¿Es posible mostrar el enlace de invitación sobre la misma ventana del usuario que lo está invitando? Esto para copiarlo y enviarlo personalmente. Entiendo que no es seguro, pero si hay fallos con el envío del correo o nunca llega por motivo del servidor SMTP tengamos la opción de copiar la invitación y compartirla personalmente por otro medio." Y, tras exponer el riesgo y las mitigaciones: "seria mejor ver el enlace, incluso para pruebas es bueno, pero en produccion tambien debe funcionar asi con la nueva sugerencia".

Hoy (verificado en `invitations.ts`): el correo se envía al invitar; el token solo se guarda como SHA-256 y quien invita nunca lo ve. Si el correo falla, la invitación no se confirma.

Reglas nuevas:

1. Quien invita puede pedir ver el enlace al crear la invitación y al reenviarla. Es opcional: el flujo por correo sigue igual por defecto.
2. Pedir el enlace exige el permiso propio `user.invite_link` (techo 2, igual que `user.invite`) Y `user.invite`. Con él, el motor exige reautenticación reciente (`ACTION_POLICY`).
3. Con el enlace pedido, el correo se intenta igual, pero un fallo de envío NO deshace la invitación: la respuesta dice `emailSent: false` y trae el enlace. Es el caso de uso del dueño (SMTP caído).
4. El enlace viaja una sola vez, en la respuesta de esa petición. No se guarda en ningún lado: ni en la tabla de idempotencia (por eso los endpoints nuevos NO son `@Idempotent()`), ni en la auditoría, ni en registros. La respuesta lleva `Cache-Control: no-store`.
5. Cada vez que se entrega un enlace se audita (`user.invitation_link_revealed`) con quién, a qué invitación y si el correo salió. Las negaciones también se auditan (motor).
6. En el navegador, el enlace vive solo en el estado local del componente que lo muestra, con botón de copiar; al cerrar el diálogo se pierde. Para volver a verlo hay que reenviar (genera otro token y revoca el anterior).
7. Por defecto reciben el permiso los roles de sistema que ya tienen `user.invite` (Raíz, Administrador, Líder). Los roles personalizados no lo reciben solos (mínimo privilegio).

Riesgo declarado: quien ve el enlace puede aceptar la invitación en lugar del invitado. Mitigaciones: permiso aparte, reautenticación, auditoría de cada entrega, un solo uso del enlace, vencimiento de 72 h y reenviar revoca el enlace anterior.

## Decisiones de diseño

- **Dos endpoints nuevos en vez de un indicador en los existentes**: `POST /invitations/with-link` y `POST /invitations/:id/resend-with-link`. Los existentes son `@Idempotent()` y el interceptor guarda el cuerpo de la respuesta, lo que dejaría el enlace en claro en la base.
- **Un reintento no duplica**: una segunda petición idéntica choca con la invitación pendiente (`INVITATION.CONFLICT`); no hay reproducción de la respuesta.
- **Base del enlace**: `APP_ORIGIN` inyectado en el caso de uso; la construcción del enlace es una única función compartida con el correo.

## Tareas

- [ ] Contrato: permiso `user.invite_link` y respuesta con `link` y `emailSent`.
- [ ] Motor: techo, política con reautenticación, `SYSTEM_ROLES_VERSION` 4 → 5.
- [ ] Migración 0026 (función de techo y concesión a roles de sistema con `user.invite`).
- [ ] Casos de uso, controlador, auditoría, contenedor.
- [ ] Web: diálogo con el enlace y botón de copiar; i18n es-MX y en-US.
- [ ] Pruebas (ver abajo), documentación, jueces ciegos y mutación.

## Bitácora

- 2026-10-30: especificación y diseño. La migración toma el número 0026; IC-3a pasaba a ser la 0027, pero la tomó `roles-and-special-permissions.md`: IC-3a es ahora la 0028.
