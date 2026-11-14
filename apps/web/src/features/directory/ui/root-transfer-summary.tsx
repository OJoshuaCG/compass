import { Card, CardBody, StatusBadge, type Status } from '@iam/ui';

export type RootTransferSummaryItem = {
  label: string;
  value: string;
};

export type RootTransferSummaryProps = {
  /** Estado ya traducido; el color nunca va solo, la insignia lleva ícono y texto. */
  statusLabel: string;
  status: Status;
  items: readonly RootTransferSummaryItem[];
};

/** Resumen de la transferencia abierta: estado y datos clave. Presentacional, sin datos del servidor. */
export function RootTransferSummary({ statusLabel, status, items }: RootTransferSummaryProps) {
  return (
    <Card>
      <CardBody>
        <div className="flex flex-col gap-4">
          <div>
            <StatusBadge status={status} label={statusLabel} />
          </div>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
            {items.map((item) => (
              <div key={item.label} className="flex flex-col gap-1">
                <dt className="text-sm text-text-secondary">{item.label}</dt>
                <dd className="font-medium text-text">{item.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </CardBody>
    </Card>
  );
}
