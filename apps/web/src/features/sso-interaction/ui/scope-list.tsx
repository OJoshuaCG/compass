import { Check } from '@iam/ui';
import { useTranslation } from 'react-i18next';

import { SSO_NAMESPACE } from '../locales/register';
import { isKnownScope } from '../model/scopes';

export type ScopeListProps = {
  scopes: readonly string[];
  heading: string;
};

/**
 * Permisos que pide la aplicación. Los conocidos se explican en lenguaje llano; los demás se
 * muestran tal cual en fuente monoespaciada (es un identificador que debe leerse exacto).
 */
export function ScopeList({ scopes, heading }: ScopeListProps) {
  const { t } = useTranslation(SSO_NAMESPACE);
  const uniqueScopes = [...new Set(scopes)];
  return (
    <section aria-labelledby="sso-scopes-heading" className="flex flex-col gap-3">
      <h2 id="sso-scopes-heading" className="text-sm font-semibold text-text">
        {heading}
      </h2>
      <ul className="flex flex-col gap-3">
        {uniqueScopes.map((scope) => (
          <li key={scope} className="flex min-w-0 items-start gap-3">
            <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
            {isKnownScope(scope) ? (
              <div className="flex min-w-0 flex-col">
                <span className="text-sm text-text">{t(`scope.${scope}.label`)}</span>
                <span className="text-sm text-text-secondary">
                  {t(`scope.${scope}.description`)}
                </span>
              </div>
            ) : (
              <span className="min-w-0 font-mono text-sm break-all text-text">{scope}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
