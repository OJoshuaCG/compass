import type { Ref } from 'react';
import { useTranslation } from 'react-i18next';

export type SummaryItem = { id: string; label: string; value: number };

export type CredentialImportSummaryProps = {
  /** Título ya traducido del bloque; se lee como nombre del grupo. */
  title: string;
  items: SummaryItem[];
  /** Destino del foco al mostrar el resultado; el título se enfoca solo por código. */
  headingRef?: Ref<HTMLHeadingElement>;
};

/**
 * Conteos en una lista de definiciones (término y valor), para que un lector de pantalla los una.
 * Solo recibe números: no hay contenido del archivo en este componente.
 */
export function CredentialImportSummary({
  title,
  items,
  headingRef,
}: CredentialImportSummaryProps) {
  const { i18n } = useTranslation();
  const numberFormat = new Intl.NumberFormat(i18n.language);
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="text-lg text-text focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
      >
        {title}
      </h2>
      <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        {items.map((item) => (
          <div key={item.id} className="flex items-baseline gap-2">
            <dt className="text-text-secondary">{item.label}</dt>
            <dd className="font-medium text-text">{numberFormat.format(item.value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
