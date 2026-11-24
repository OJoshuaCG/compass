import { Alert, Button } from '@iam/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import { navigateToProvider, interactionContinuePath } from '../api/full-page-navigation';
import { reauthenticateWithPasskey } from '../api/passkey-reauth';
import { ssoApi } from '../api/sso-api';
import { useLazyCatalog } from '../../../shared/i18n/use-lazy-catalog';
import { SSO_NAMESPACE } from '../locales/register';
import { isValidInteractionUid } from '../model/interaction-uid';
import { InvalidRequest } from '../ui/invalid-request';
import { SsoCard } from '../ui/sso-card';
import { TotpCodeForm } from '../ui/totp-code-form';

export type SsoReauthPageProps = {
  /** `uid` de la interacción tal como llegó en la URL; se valida aquí. */
  uid: string | undefined;
};

/**
 * Container de `/sso/reauth`: una aplicación OIDC pidió reautenticar (`prompt=login` / `max_age`).
 * Se confirma con TOTP o llave de acceso y, al terminar, se devuelve el control al proveedor con
 * una navegación de página completa (la ruta `/oidc/...` no es de la SPA).
 */
export function SsoReauthPage(props: SsoReauthPageProps) {
  // Sin el catálogo cargado los textos saldrían como claves: no se pinta nada hasta tenerlo.
  const catalogReady = useLazyCatalog(SSO_NAMESPACE);
  return catalogReady ? <SsoReauthPageContent {...props} /> : null;
}

function SsoReauthPageContent({ uid }: SsoReauthPageProps) {
  const { t } = useTranslation(SSO_NAMESPACE);
  const verify = useAsyncAction(ssoApi.reauthWithCode);
  const passkey = useAsyncAction(() => reauthenticateWithPasskey(ssoApi));
  const passkeyCooldown = useRateLimitCooldown(passkey.error);
  const [cancelled, setCancelled] = useState(false);
  // Tras el éxito se mantiene el formulario bloqueado mientras el navegador cambia de página.
  const [redirecting, setRedirecting] = useState(false);

  if (!isValidInteractionUid(uid)) {
    return (
      <InvalidRequest
        title={t('invalid.title')}
        description={t('invalid.description')}
        goHomeLabel={t('invalid.goHome')}
      />
    );
  }

  const resume = () => {
    setRedirecting(true);
    navigateToProvider(interactionContinuePath(uid));
  };

  const submitCode = async (code: string) => {
    const result = await verify.run(code);
    if (result.ok) resume();
  };

  const startPasskey = async () => {
    setCancelled(false);
    const result = await passkey.run();
    if (!result.ok) return;
    // Cancelar el aviso del navegador no es un error: se avisa en neutro y se queda aquí.
    if (result.value === 'cancelled') {
      setCancelled(true);
      return;
    }
    resume();
  };

  return (
    <SsoCard title={t('reauth.title')} description={t('reauth.description')}>
      <TotpCodeForm
        label={t('reauth.code')}
        submitLabel={t('reauth.submit')}
        pending={verify.pending || redirecting}
        error={verify.error}
        onSubmit={(code) => {
          void submitCode(code);
        }}
      />
      <div className="flex flex-col gap-3 border-t border-border pt-4">
        {passkey.error instanceof ApiError ? (
          <ErrorAlert error={passkey.error} secondsLeft={passkeyCooldown.secondsLeft} />
        ) : passkey.error !== undefined ? (
          // Fallo del navegador o del autenticador (no de la API): no hay código que traducir.
          <ErrorAlert error={passkey.error} />
        ) : null}
        {cancelled ? <Alert tone="info">{t('reauth.passkeyCancelled')}</Alert> : null}
        <Button
          variant="secondary"
          loading={passkey.pending}
          disabled={passkeyCooldown.secondsLeft > 0 || redirecting || verify.pending}
          onClick={() => {
            void startPasskey();
          }}
        >
          {t('reauth.usePasskey')}
        </Button>
      </div>
      {redirecting ? <Alert tone="success">{t('reauth.redirecting')}</Alert> : null}
    </SsoCard>
  );
}
