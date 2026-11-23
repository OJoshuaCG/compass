import { Check, XCircle, cn } from '@iam/ui';
import { useTranslation } from 'react-i18next';

import type { DemoAuditEvent } from '../model/demo-events';

/** Resultado con ícono y texto: el color nunca es el único canal. */
export function ResultLabel({ result }: { result: DemoAuditEvent['result'] }) {
  const { t } = useTranslation('common');
  const Icon = result === 'allowed' ? Check : XCircle;
  return (
    <span
      className={cn(
        'flex items-center gap-1.5 font-semibold',
        result === 'allowed' ? 'text-success' : 'text-danger',
      )}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      {t(`auditPreview.result.${result}`)}
    </span>
  );
}
