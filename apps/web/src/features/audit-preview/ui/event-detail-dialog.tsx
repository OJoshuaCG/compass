import { Dialog } from '@iam/ui';
import { useTranslation } from 'react-i18next';

import { previousHash, type DemoAuditEvent } from '../model/demo-events';

import { ResultLabel } from './result-label';
import { useEventText } from './use-event-text';

export type EventDetailDialogProps = {
  event: DemoAuditEvent;
  /** Fecha y hora ya formateadas en el idioma y la zona de la persona. */
  when: string;
  onClose: () => void;
};

/**
 * Detalle de un evento en un panel lateral, como en el diseño de Compass: resultado, motivo
 * declarado, campos del evento y su encadenamiento con el anterior.
 */
export function EventDetailDialog({ event, when, onClose }: EventDetailDialogProps) {
  const { t } = useTranslation('common');
  const text = useEventText()(event);
  const previous = previousHash(event);
  const fields: [string, string][] = [
    [t('auditPreview.field.actor'), event.actor ?? t('auditPreview.unknownActor')],
    [t('auditPreview.field.type'), t(`auditPreview.types.${event.type}`)],
    [t('auditPreview.field.object'), text.subject],
    [t('auditPreview.field.origin'), event.origin],
    [t('auditPreview.field.eventId'), event.id],
    [t('auditPreview.field.requestId'), `req_${event.hash.slice(12, 24)}`],
  ];
  return (
    <Dialog
      open
      placement="side"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={text.action}
      description={when}
      closeLabel={t('dialog.close')}
    >
      <div className="flex flex-col gap-6 text-sm">
        <div className="flex flex-col gap-1">
          <ResultLabel result={event.result} />
          <p className="text-text-secondary">{t(`auditPreview.resultLong.${event.result}`)}</p>
        </div>

        {event.reason !== undefined ? (
          <div className="flex flex-col gap-1 rounded-md bg-raised p-3">
            <span className="text-xs font-semibold uppercase text-text-muted">
              {t('auditPreview.field.reason')}
            </span>
            <q className="text-text">{event.reason}</q>
          </div>
        ) : null}

        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {fields.map(([label, value]) => (
            <div key={label} className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-xs text-text-muted">{label}</dt>
              <dd className="break-words text-text">{value}</dd>
            </div>
          ))}
        </dl>

        <section aria-labelledby={`chain-${event.id}`} className="flex flex-col gap-2">
          <h3 id={`chain-${event.id}`} className="text-xs font-semibold uppercase text-text-muted">
            {t('auditPreview.field.chain')}
          </h3>
          <dl className="flex flex-col gap-1 rounded-md bg-raised p-3 font-mono text-xs break-all">
            <div className="flex gap-2">
              <dt className="shrink-0 text-text-muted">{t('auditPreview.field.previous')}</dt>
              <dd className="text-text">{previous ?? t('auditPreview.field.genesis')}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="shrink-0 text-text-muted">{t('auditPreview.field.current')}</dt>
              <dd className="font-semibold text-text">{event.hash}</dd>
            </div>
          </dl>
          <p className="text-xs text-text-secondary">{t('auditPreview.field.chainHelp')}</p>
        </section>
      </div>
    </Dialog>
  );
}
