-- 0030: la recepción recuerda de qué plantilla vino (ADR 0045, IC-5a).
--
-- El historial que ve VIEW es "solo lo que casó con la vista" y una vista es un conjunto de plantillas
-- (`mail_view_templates`). Hasta hoy la recepción solo guardaba `item_id`, y la purga lo suelta a los
-- 10 minutos: pasado ese tiempo ninguna recepción podía atribuirse a una vista y el historial de 30 días
-- quedaba vacío. `template_id` conserva ese vínculo sin guardar nada del mensaje.
--
-- Las recepciones anteriores a esta migración quedan sin plantilla y no aparecen en ninguna vista: el
-- sondeo todavía no está desplegado, así que no hay datos que migrar (y recorrer la tabla con RLS forzado
-- desde el migrador no vería filas de ninguna organización).
alter table inbound_receipts add column template_id uuid;

-- Una cuarentena nunca casó con una plantilla; solo una recepción aceptada puede llevarla.
alter table inbound_receipts
  add constraint inbound_receipts_template_only_accepted
  check (outcome = 'accepted' or template_id is null);

alter table inbound_receipts
  add constraint inbound_receipts_template_fk
  foreign key (organization_id, template_id) references inbound_templates (organization_id, id);

-- Historial por plantilla, del más reciente al más antiguo, con `id` para desempatar el cursor.
create index inbound_receipts_template_history
  on inbound_receipts (organization_id, template_id, received_at desc, id desc)
  where template_id is not null;
