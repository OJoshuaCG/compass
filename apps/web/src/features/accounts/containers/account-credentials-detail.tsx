import { useQuery } from '@tanstack/react-query';

import { useMe } from '../../../shared/auth';
import { useErrorMessage } from '../../../shared/i18n';
import { accountsKeys, fetchAccountCredentials } from '../api/accounts-api';
import { AccountCredentialsList } from '../ui/account-credentials-list';

export type AccountCredentialsDetailProps = {
  accountId: string;
  accountName: string;
};

/**
 * Detalle de una fila abierta de Cuentas: pide las credenciales de esa cuenta al montarse. La
 * tabla solo monta este componente mientras la fila está abierta, así nada se pide por adelantado
 * y siempre se muestra el estado actual (`staleTime: 0`).
 */
export function AccountCredentialsDetail({
  accountId,
  accountName,
}: AccountCredentialsDetailProps) {
  const errorMessage = useErrorMessage();
  const timeZone = useMe()?.user.timezone;
  const query = useQuery({
    queryKey: accountsKeys.credentials(accountId),
    queryFn: ({ signal }) => fetchAccountCredentials(accountId, signal),
    staleTime: 0,
  });
  return (
    <AccountCredentialsList
      accountId={accountId}
      accountName={accountName}
      status={query.isPending ? 'loading' : query.isError ? 'error' : 'success'}
      credentials={query.data ?? []}
      errorMessage={query.isError ? errorMessage(query.error) : ''}
      onRetry={() => {
        void query.refetch();
      }}
      timeZone={timeZone}
    />
  );
}
