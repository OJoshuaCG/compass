-- 0041: la vista previa de un correo es de quien la pidió (ADR 0045, enmienda 2026-11-10;
-- odd/tasks/inbound-mail-delete.md, L16).
--
-- Con la 0040 había una sola petición viva por recibo y clase, compartida: si una persona la pedía y otra con
-- permiso la pedía después, ambas apuntaban a la misma fila y quien leyera primero se llevaba el contenido
-- (la otra recibía «ya se leyó»). El dueño decidió que cada persona tenga su propia petición: el contenido
-- cifrado solo lo entrega a quien lo pidió y nadie puede quitárselo a otra persona.
--
-- Esta migración NO edita la 0040 (migración aplicada). Solo cambia el índice único parcial: ahora incluye
-- `requested_by`. Una petición fallida sigue sin bloquear volver a pedir. No cambia columnas, permisos,
-- aislamiento por organización ni las funciones de descubrimiento del worker; el worker atiende cada fila por
-- separado (una descarga por persona que pidió).
-- Toda tabla conserva organización, índice y política de aislamiento de la 0040.

drop index mail_preview_requests_one_live_per_receipt_kind;
create unique index mail_preview_requests_one_live_per_receipt_kind_person
  on mail_preview_requests (organization_id, receipt_id, kind, requested_by) where status <> 'failed';
