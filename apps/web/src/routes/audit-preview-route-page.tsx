import { getRouteApi } from '@tanstack/react-router';

import { AuditPreviewPage } from '../features/audit-preview';
import { useMe } from '../shared/auth';

import { auditPreviewSearchSchema } from './audit-preview-search';
import { NotFoundPage } from './not-found-page';

// `getRouteApi` evita importar la definición de la ruta (que carga este archivo de forma
// diferida) y así no hay dependencia circular.
const route = getRouteApi('/_app/audit');

/**
 * Container de `/audit`: solo con permiso para leer la auditoría (toda o la de su ámbito); sin él
 * responde como una ruta inexistente. Es comodidad: la lectura real la decidirá el servidor (R1).
 */
export function AuditPreviewRoutePage() {
  const me = useMe();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  if (me === undefined) return null;
  const canRead =
    me.permissions.includes('audit.read_all') || me.permissions.includes('audit.read_scope');
  if (!canRead) return <NotFoundPage />;
  return (
    <AuditPreviewPage
      search={search}
      onSearchChange={(patch) => {
        void navigate({
          search: (previous) => auditPreviewSearchSchema.parse({ ...previous, ...patch }),
        });
      }}
    />
  );
}
