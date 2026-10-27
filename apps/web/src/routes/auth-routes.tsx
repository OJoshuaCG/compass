import {
  EnrollPage,
  InvitationPage,
  LoginPage,
  MfaPage,
  PasswordChangePage,
} from '../features/auth';
import { Link, getRouteApi, useRouter, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { navigateAfterAuth } from './return-navigation';
import { readInvitationToken } from './invitation-token';

const loginRoute = getRouteApi('/_public/login');
const mfaRoute = getRouteApi('/_public/login/mfa');
const passwordChangeRoute = getRouteApi('/_public/password/change');
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
      onNext={(status, { passkeys }) => {
        const search = returnTo === undefined ? {} : { returnTo };
        if (status === 'mfa_required') {
          void navigate({
            to: '/login/mfa',
            search: passkeys === undefined ? search : { ...search, passkeys },
          });
          return;
        }
        const to = {
          password_change_required: '/password/change',
          enrollment_required: '/enroll',
        } as const;
        void navigate({ to: to[status], search });
      }}
    />
  );
}

/** Lleva a `/password/change` conservando la ruta de retorno (el servidor exige el cambio). */
function usePasswordChangeRedirect(returnTo: string | undefined) {
  const router = useRouter();
  return () => {
    void router.navigate({
      to: '/password/change',
      search: returnTo === undefined ? {} : { returnTo },
    });
  };
}

export function MfaRoute() {
  const { t } = useTranslation('auth');
  const { returnTo, passkeys } = mfaRoute.useSearch();
  const goBack = useReturnNavigation();
  const toPasswordChange = usePasswordChangeRedirect(returnTo);
  return (
    <MfaPage
      passkeys={passkeys}
      onVerified={() => {
        goBack(returnTo);
      }}
      onPasswordChangeRequired={toPasswordChange}
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
  const toPasswordChange = usePasswordChangeRedirect(returnTo);
  return (
    <EnrollPage
      onDone={() => {
        goBack(returnTo);
      }}
      onPasswordChangeRequired={toPasswordChange}
    />
  );
}

export function PasswordChangeRoute() {
  const { t } = useTranslation('auth');
  const { returnTo } = passwordChangeRoute.useSearch();
  const navigate = passwordChangeRoute.useNavigate();
  const goBack = useReturnNavigation();
  return (
    <PasswordChangePage
      onChanged={(state) => {
        // Se continúa según `/me`: segundo factor, registro del mismo, o la app.
        const search = returnTo === undefined ? {} : { returnTo };
        switch (state.kind) {
          case 'authenticated':
            goBack(returnTo);
            break;
          case 'enrollment_required':
            void navigate({ to: '/enroll', search });
            break;
          case 'mfa_required':
            void navigate({ to: '/login/mfa', search });
            break;
          case 'anonymous':
            void navigate({ to: '/login', search });
            break;
          case 'password_change_required':
            // El servidor sigue pidiendo el cambio: se queda aquí, no hay a dónde avanzar.
            break;
        }
      }}
      footer={
        <Link to="/login" className={linkClass}>
          {t('passwordChange.backToLogin')}
        </Link>
      }
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
