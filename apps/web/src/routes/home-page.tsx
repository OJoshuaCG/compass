import { PageHeader } from '@iam/ui';
import { useTranslation } from 'react-i18next';

import { HomeSummary } from '../features/home';

/**
 * Aguja decorativa de la marca (compás con la aguja de latón). Es adorno puro: va oculta para
 * lectores de pantalla y solo usa tokens de color vía `currentColor`.
 */
function CompassArt() {
  return (
    <svg
      viewBox="0 0 160 160"
      width="136"
      height="136"
      aria-hidden="true"
      focusable="false"
      className="text-text-muted"
    >
      <circle cx="80" cy="80" r="74" fill="none" stroke="currentColor" opacity=".4" />
      <circle
        cx="80"
        cy="80"
        r="66"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeDasharray="1 7.64"
        opacity=".55"
      />
      <circle cx="80" cy="80" r="46" fill="none" stroke="currentColor" opacity=".4" />
      <g transform="rotate(38 80 80)">
        <path d="M80 28l9 52H71z" className="fill-accent" />
        <path d="M80 132l9-52H71z" fill="currentColor" opacity=".5" />
      </g>
      <circle cx="80" cy="80" r="4.5" className="fill-canvas" stroke="currentColor" />
    </svg>
  );
}

export function HomePage() {
  const { t } = useTranslation('common');
  return (
    <>
      <PageHeader
        eyebrow={t('nav.group.workspace')}
        title={t('home.title')}
        description={t('home.description')}
        actions={<CompassArt />}
      />
      <HomeSummary />
    </>
  );
}
