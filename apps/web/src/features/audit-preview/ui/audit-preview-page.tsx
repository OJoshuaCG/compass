import {
  Alert,
  Button,
  DataTable,
  EmptyState,
  Eye,
  IconBubble,
  KeyRound,
  MonitorSmartphone,
  PageHeader,
  RefreshCw,
  SearchInput,
  Share2,
  ShieldCheck,
  UserPlus,
  XCircle,
  type Column,
  type LucideIcon,
} from '@iam/ui';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTableQuery, type TableSearch } from '../../../shared/api';
import { useMe } from '../../../shared/auth';
import { useDataTableLabels, useErrorMessage } from '../../../shared/i18n';
import { formatDateTime } from '../../../shared/lib';
import {
  AUDIT_RANGES,
  AUDIT_TYPE_FILTERS,
  countByType,
  createDemoAuditFetcher,
  createDemoEvents,
  DEMO_CHAIN_TOTAL,
  type AuditRange,
  type AuditType,
  type AuditTypeFilter,
  type DemoAuditEvent,
} from '../model/demo-events';

import { EventDetailDialog } from './event-detail-dialog';
import { ResultLabel } from './result-label';
import { useEventText } from './use-event-text';

export type AuditPreviewSearch = TableSearch & { type: AuditTypeFilter; range: AuditRange };

export type AuditPreviewPageProps = {
  search: AuditPreviewSearch;
  onSearchChange: (patch: Partial<AuditPreviewSearch>) => void;
};

/** Ícono y tono de cada tipo: el texto del evento siempre acompaña (el color no es el único canal). */
export const TYPE_STYLE: Record<
  AuditType,
  { icon: LucideIcon; tone: 'accent' | 'success' | 'warning' | 'danger' }
> = {
  reveal: { icon: Eye, tone: 'warning' },
  totp: { icon: KeyRound, tone: 'accent' },
  share: { icon: Share2, tone: 'accent' },
  people: { icon: UserPlus, tone: 'success' },
  session: { icon: MonitorSmartphone, tone: 'accent' },
  denied: { icon: XCircle, tone: 'danger' },
};

/** Iniciales para el avatar: primera letra de las dos primeras palabras del nombre. */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');

/** Hash abreviado para la tabla; el completo está en el detalle. */
const shortHash = (hash: string) => `${hash.slice(0, 4)}…${hash.slice(-4)}`;

/**
 * Vista previa de la pantalla de auditoría (diseño de Compass), solo en desarrollo. Usa eventos
 * ficticios con el contrato de listados; la pantalla real llegará con la lectura de auditoría (R1).
 */
export function AuditPreviewPage({ search, onSearchChange }: AuditPreviewPageProps) {
  const { t, i18n } = useTranslation('common');
  const labels = useDataTableLabels();
  const errorMessage = useErrorMessage();
  const eventText = useEventText();
  const me = useMe();
  const timeZone = me?.user.timezone;
  const [open, setOpen] = useState<DemoAuditEvent | null>(null);
  // Se fija al montar: las antigüedades de los eventos ficticios se miden desde aquí.
  const [now] = useState(() => Date.now());
  const { type, range, ...tableSearch } = search;
  const events = useMemo(() => createDemoEvents(), []);
  const counts = useMemo(() => countByType(events, range), [events, range]);
  // Un fetcher por filtro: el tipo y el periodo forman parte de la clave, igual que haría la API.
  const fetchPage = useMemo(
    () => createDemoAuditFetcher(type, range, events),
    [type, range, events],
  );

  const table = useTableQuery<DemoAuditEvent>({
    queryKey: ['audit-preview', 'events', type, range],
    fetchPage,
    search: tableSearch,
    onSearchChange,
  });

  const when = (event: DemoAuditEvent) =>
    formatDateTime(
      new Date(now - event.minutesAgo * 60_000).toISOString(),
      i18n.language,
      timeZone,
    );

  const columns: Column<DemoAuditEvent>[] = [
    {
      id: 'when',
      header: t('auditPreview.col.when'),
      cell: (row) => <span className="whitespace-nowrap text-text-muted">{when(row)}</span>,
    },
    {
      id: 'actor',
      header: t('auditPreview.col.actor'),
      cell: (row) => (
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-raised text-xs font-bold text-accent"
          >
            {row.actor === null ? '?' : initials(row.actor)}
          </span>
          <span className="font-semibold text-text">
            {row.actor ?? t('auditPreview.unknownActor')}
          </span>
        </span>
      ),
    },
    {
      id: 'event',
      header: t('auditPreview.col.event'),
      cell: (row) => {
        const { icon: Icon, tone } = TYPE_STYLE[row.type];
        const text = eventText(row);
        return (
          <span className="flex items-center gap-3">
            <IconBubble tone={tone} icon={<Icon className="size-4" />} className="size-8" />
            <span className="flex min-w-0 flex-col">
              <span className="font-semibold text-text">{text.action}</span>
              <span className="text-text-muted">{text.subject}</span>
            </span>
          </span>
        );
      },
    },
    {
      id: 'result',
      header: t('auditPreview.col.result'),
      cell: (row) => <ResultLabel result={row.result} />,
    },
    {
      id: 'hash',
      header: t('auditPreview.col.hash'),
      cell: (row) => (
        <code className="font-mono text-xs text-text-muted">#{shortHash(row.hash)}</code>
      ),
    },
  ];

  const total = new Intl.NumberFormat(i18n.language).format(DEMO_CHAIN_TOTAL);

  return (
    <>
      <PageHeader
        title={t('auditPreview.title')}
        description={t('auditPreview.description')}
        actions={
          <Button variant="secondary" disabled title={t('auditPreview.notAvailable')}>
            {t('auditPreview.export')}
          </Button>
        }
      />

      <Alert tone="info">{t('auditPreview.notice')}</Alert>

      {/* Estado de la cadena: único bloque oscuro de la pantalla, como en el diseño. */}
      <section
        aria-labelledby="audit-chain-title"
        className="flex flex-wrap items-center gap-4 rounded-lg bg-nav p-5 text-nav-text [&_:focus-visible]:outline-nav-focus"
      >
        <IconBubble tone="success" icon={<ShieldCheck className="size-5" />} className="size-11" />
        <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
          <h2 id="audit-chain-title" className="text-base font-bold">
            {t('auditPreview.chain.title')}
          </h2>
          <p className="text-sm text-nav-text-muted">{t('auditPreview.chain.note', { total })}</p>
        </div>
        <dl className="flex gap-6 text-sm">
          <div className="flex flex-col">
            <dt className="text-nav-text-muted">{t('auditPreview.chain.events')}</dt>
            <dd className="text-lg font-bold tabular-nums">{total}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-nav-text-muted">{t('auditPreview.chain.lastHash')}</dt>
            <dd className="font-mono text-lg">{shortHash(events[0]?.hash ?? '')}</dd>
          </div>
        </dl>
        <Button
          variant="secondary"
          size="sm"
          disabled
          title={t('auditPreview.notAvailable')}
          className="border-nav-raised bg-nav-raised text-nav-text"
        >
          <RefreshCw aria-hidden="true" className="size-4" />
          {t('auditPreview.chain.verify')}
        </Button>
      </section>

      <DataTable<DemoAuditEvent>
        caption={t('auditPreview.caption')}
        columns={columns}
        rows={table.rows}
        getRowId={(row) => row.id}
        status={table.status}
        onSortChange={() => undefined}
        limit={table.limit}
        onLimitChange={table.onLimitChange}
        pagination={table.pagination}
        refreshing={table.refreshing}
        hasActiveFilters={table.hasActiveFilters || type !== 'all'}
        onClearFilters={() => {
          onSearchChange({ q: undefined, type: 'all' });
        }}
        labels={labels}
        emptyState={<EmptyState title={t('auditPreview.empty.title')} />}
        errorState={{ message: errorMessage(table.error), onRetry: table.retry }}
        rowActions={(row) => (
          <Button
            variant="secondary"
            size="sm"
            aria-haspopup="dialog"
            aria-label={t('auditPreview.openLabel', {
              action: eventText(row).action,
              when: when(row),
            })}
            onClick={() => {
              setOpen(row);
            }}
          >
            {t('auditPreview.open')}
          </Button>
        )}
        toolbar={
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <SearchInput
                className="min-w-0 flex-1 basis-64"
                label={t('auditPreview.search.label')}
                clearLabel={t('search.clear')}
                placeholder={t('auditPreview.search.placeholder')}
                value={table.q}
                onValueChange={table.onQueryChange}
              />
              <div
                role="group"
                aria-label={t('auditPreview.range.label')}
                className="flex gap-1 rounded-md border border-border-input p-1"
              >
                {AUDIT_RANGES.map((option) => (
                  <Button
                    key={option}
                    size="sm"
                    variant={option === range ? 'primary' : 'ghost'}
                    aria-pressed={option === range}
                    onClick={() => {
                      onSearchChange({ range: option });
                    }}
                  >
                    {t(`auditPreview.range.${option}`)}
                  </Button>
                ))}
              </div>
            </div>
            <div
              role="group"
              aria-label={t('auditPreview.types.label')}
              className="flex flex-wrap gap-2"
            >
              {AUDIT_TYPE_FILTERS.map((option) => (
                <Button
                  key={option}
                  size="sm"
                  variant={option === type ? 'primary' : 'secondary'}
                  aria-pressed={option === type}
                  className="rounded-full"
                  onClick={() => {
                    onSearchChange({ type: option });
                  }}
                >
                  {t(`auditPreview.types.${option}`)}{' '}
                  <span className="tabular-nums opacity-80">{counts[option]}</span>
                </Button>
              ))}
            </div>
          </div>
        }
      />

      {open !== null ? (
        <EventDetailDialog
          event={open}
          when={when(open)}
          onClose={() => {
            setOpen(null);
          }}
        />
      ) : null}
    </>
  );
}
