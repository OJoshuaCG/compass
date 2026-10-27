import { EnrollPage, InvitationPage, LoginPage, MfaPage } from '../features/auth';
import { Link, getRouteApi, useRouter, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { navigateAfterAuth } from './return-navigation';
import { readInvitationToken } from './invitation-token';

const loginRoute = getRouteApi('/_public/login');
const mfaRoute = getRouteApi('/_public/login/mfa');
const enrollRoute = getRouteApi('/_public/enroll');
const invitationRoute = getRouteApi('/_public/invitation');

const linkClass = 'text-sm text-accent underline underline-offset-4';

function useReturnNavigation() {
  const router = useRouter();
  /** Vuelve a donde iba el usuario (si la ruta es interna) o al inicio. */
  return (returnTo: string | undefined) => {
    navigateAfterAuth(router, returnTo);
  };
}

export function LoginRoute() {
  const { returnTo } = loginRoute.useSearch();
  const navigate = loginRoute.useNavigate();
  return (
    <LoginPage
      onNext={(status) => {
        const search = returnTo === undefined ? {} : { returnTo };
        void navigate({ to: status === 'mfa_required' ? '/login/mfa' : '/enroll', search });
      }}
    />
  );
}

export function MfaRoute() {
  const { t } = useTranslation('auth');
  const { returnTo } = mfaRoute.useSearch();
  const goBack = useReturnNavigation();
  return (
    <MfaPage
      onVerified={() => {
        goBack(returnTo);
      }}
      footer={
        <Link to="/login" className={linkClass}>
          {t('mfa.backToLogin')}
        </Link>
      }
    />
  );
}

export function EnrollRoute() {
  const { returnTo } = enrollRoute.useSearch();
  const goBack = useReturnNavigation();
  return (
    <EnrollPage
      onDone={() => {
        goBack(returnTo);
      }}
    />
  );
}

export function InvitationRoute() {
  const { t } = useTranslation('auth');
  const router = useRouter();
  const search = invitationRoute.useSearch();
  const hash = useRouterState({ select: (state) => state.location.hash });
  // El token se lee una sola vez y se guarda en el estado: la URL se limpia enseguida.
  const [initial] = useState(() => readInvitationToken(search.token, hash));

  useEffect(() => {
    // Un token en la URL queda en el historial y en registros de acceso: se retira de inmediato.
    if (initial.fromUrl) router.history.replace('/invitation');
  }, [initial.fromUrl, router]);

  return (
    <InvitationPage
      token={initial.token}
      onAccepted={() => {
        void router.navigate({ to: '/enroll' });
      }}
      footer={
        <Link to="/login" className={linkClass}>
          {t('invitation.goToLogin')}
        </Link>
      }
    />
  );
}
