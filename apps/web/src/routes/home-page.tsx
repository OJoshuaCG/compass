import { PageHeader } from '@iam/ui';
import { useTranslation } from 'react-i18next';

export function HomePage() {
  const { t } = useTranslation('common');
  return <PageHeader title={t('home.title')} description={t('home.description')} />;
}
