import { Button, Spinner } from '@iam/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAsyncAction } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import {
  loadConsent,
  submitConsentDecision,
  type ConsentDecision,
  type ConsentLoadResult,
} from '../api/consent-api';
import { authorizationResumePath, navigateToProvider } from '../api/full-page-navigation';
import { useLazyCatalog } from '../../../shared/i18n/use-lazy-catalog';
import { SSO_NAMESPACE } from '../locales/register';
import { isValidInteractionUid } from '../model/interaction-uid';
import { InvalidRequest } from '../ui/invalid-request';
import { ScopeList } from '../ui/scope-list';
import { SsoCard } from '../ui/sso-card';

export type SsoConsentPageProps = {
  /** `uid` de la interacción tal como llegó en la URL; se valida aquí. */
  uid: string | undefined;
};

type LoadState =
  | { phase: 'loading' }
  | { phase: 'failed'; error: unknown }
  | { phase: 'done'; result: ConsentLoadResult };

/**
 * Container de `/sso/consent`: muestra qué aplicación pide acceso y con qué permisos. La
 * decisión se envía con `fetch` y, al aceptarla el servidor, se vuelve al proveedor con una
 * navegación de página completa a `/oidc/auth/<uid>`.
 */
export function SsoConsentPage(props: SsoConsentPageProps) {
  // Sin el catálogo cargado los textos saldrían como claves: no se pinta nada hasta tenerlo.
  const catalogReady = useLazyCatalog(SSO_NAMESPACE);
  return catalogReady ? <SsoConsentPageContent {...props} /> : null;
}

function SsoConsentPageContent({ uid }: SsoConsentPageProps) {
  const { t } = useTranslation(SSO_NAMESPACE);
  const [load, setLoad] = useState<LoadState>({ phase: 'loading' });
  // Cada reintento de carga incrementa el contador y repite el efecto.
  const [loadAttempt, setLoadAttempt] = useState(0);
  const decide = useAsyncAction(submitConsentDecision);
  const [lastDecision, setLastDecision] = useState<ConsentDecision | undefined>(undefined);
  // Tras el éxito los botones siguen bloqueados mientras el navegador cambia de página.
  const [redirecting, setRedirecting] = useState(false);
  const validUid = isValidInteractionUid(uid) ? uid : undefined;

  useEffect(() => {
    if (validUid === undefined) return;
    const controller = new AbortController();
    loadConsent(validUid, controller.signal).then(
      (result) => {
        setLoad({ phase: 'done', result });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setLoad({ phase: 'failed', error });
      },
    );
    return () => {
      controller.abort();
    };
  }, [validUid, loadAttempt]);

  if (validUid === undefined) {
    return (
      <InvalidRequest
        title={t('invalid.title')}
        description={t('invalid.description')}
        goHomeLabel={t('invalid.goHome')}
      />
    );
  }

  if (load.phase === 'loading') {
    return (
      <SsoCard title={t('consent.loading')}>
        <Spinner />
      </SsoCard>
    );
  }

  if (load.phase === 'failed') {
    return (
      <SsoCard title={t('consent.loadErrorTitle')} focusTitle>
        <ErrorAlert
          error={load.error}
          onRetry={() => {
            // El estado de carga se fija aquí y no en el efecto: así el efecto solo sincroniza.
            setLoad({ phase: 'loading' });
            setLoadAttempt((attempt) => attempt + 1);
          }}
        />
      </SsoCard>
    );
  }

  if (load.result.kind === 'expired') {
    return (
      <InvalidRequest
        title={t('consent.expiredTitle')}
        description={t('consent.expiredDescription')}
        goHomeLabel={t('invalid.goHome')}
      />
    );
  }

  const { consent } = load.result;

  const submit = async (decision: ConsentDecision) => {
    setLastDecision(decision);
    const result = await decide.run(validUid, decision);
    if (!result.ok) return;
    setRedirecting(true);
    navigateToProvider(authorizationResumePath(validUid));
  };

  const busy = decide.pending || redirecting;

  return (
    <SsoCard
      title={t('consent.title', { client: consent.clientName })}
      description={t('consent.description')}
      focusTitle
    >
      <ScopeList scopes={consent.scopes} heading={t('consent.scopesHeading')} />
      {decide.error !== undefined && lastDecision !== undefined ? (
        <ErrorAlert
          error={decide.error}
          onRetry={() => {
            void submit(lastDecision);
          }}
        />
      ) : null}
      <div className="flex flex-wrap gap-3 border-t border-border pt-4">
        <Button
          className="max-sm:w-full"
          loading={busy && lastDecision === 'allow'}
          disabled={busy}
          onClick={() => {
            void submit('allow');
          }}
        >
          {t('consent.allow')}
        </Button>
        <Button
          variant="secondary"
          className="max-sm:w-full"
          loading={busy && lastDecision === 'deny'}
          disabled={busy}
          onClick={() => {
            void submit('deny');
          }}
        >
          {t('consent.deny')}
        </Button>
      </div>
      {redirecting ? (
        <p role="status" className="text-sm text-text-secondary">
          {t('consent.redirecting')}
        </p>
      ) : null}
    </SsoCard>
  );
}
