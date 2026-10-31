-- 0020: comparticiones vivas que otorgó una persona. Al bajar a alguien de rango se listan las que
-- otorgó para que quien hizo el cambio las revise (`listLiveGrantedBy`); sin este índice cada cambio de
-- rango recorrería todas las comparticiones de la organización. Parcial porque solo importan las no revocadas.
create index shares_org_granted_by_live on shares (organization_id, granted_by)
  where revoked_at is null;

comment on index shares_org_granted_by_live is
  'Comparticiones no revocadas por quien las otorgó: lista de revisión al cambiar el rango de una persona.';
