import { getRouteApi } from '@tanstack/react-router';

import { SsoConsentPage } from './sso-consent-page';
import { SsoReauthPage } from './sso-reauth-page';

const reauthRoute = getRouteApi('/_sso/sso/reauth');
const consentRoute = getRouteApi('/_sso/sso/consent');

/** Container de ruta de `/sso/reauth`: lee `?uid=` y se lo pasa a la pantalla, que lo valida. */
export function SsoReauthRoute() {
  const { uid } = reauthRoute.useSearch();
  return <SsoReauthPage uid={uid} />;
}

/** Container de ruta de `/sso/consent`: lee `?uid=` y se lo pasa a la pantalla, que lo valida. */
export function SsoConsentRoute() {
  const { uid } = consentRoute.useSearch();
  return <SsoConsentPage uid={uid} />;
}
