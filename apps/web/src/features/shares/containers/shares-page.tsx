import type { Share } from '@iam/contracts';
import { Button, PageHeader, Spinner } from '@iam/ui';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMe, usePermission } from '../../../shared/auth';
import { ErrorAlert, useErrorMessage } from '../../../shared/i18n';
import { useLazyCatalog } from '../../../shared/i18n/use-lazy-catalog';
import { useToast } from '../../../shared/toast';
import { fetchAccount, fetchShares, sharesKeys } from '../api/shares-api';
import { canManageShares } from '../model/share-access';
import { SharesTable } from '../ui/shares-table';

import { RevokeShareDialog } from './revoke-share-dialog';
import { ShareAccountDialog } from './share-account-dialog';

type DialogState = { kind: 'share' } | { kind: 'revoke'; share: Share } | null;

export type SharesPageProps = {
  accountId: string;
};

/**
 * Container de `/accounts/:accountId/shares`: con quién se comparte una cuenta, en la `DataTable`
 * estándar. Compartir y revocar se ofrecen con el permiso `share.manage` y nivel MANAGE; solo es
 * comodidad, el servidor decide siempre.
 */
export function SharesPage({ accountId }: SharesPageProps) {
  const catalogReady = useLazyCatalog('shares');
  const { t } = useTranslation(['shares', 'common']);
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const toast = useToast();
  const timeZone = useMe()?.user.timezone;
  const hasSharePermission = usePermission('share.manage');
  const [dialog, setDialog] = useState<DialogState>(null);

  const accountQuery = useQuery({
    queryKey: sharesKeys.account(accountId),
    queryFn: ({ signal }) => fetchAccount(accountId, signal),
    staleTime: 0,
  });
  const sharesQuery = useQuery({
    queryKey: sharesKeys.list(accountId),
    queryFn: ({ signal }) => fetchShares(accountId, signal),
    staleTime: 0,
  });

  if (!catalogReady) return <Spinner label={t('state.loading', { ns: 'common' })} />;

  const backLink = (
    <Link
      to="/accounts"
      className="inline-flex min-h-6 items-center text-sm text-accent underline underline-offset-4"
    >
      {t('back', { ns: 'shares' })}
    </Link>
  );

  if (accountQuery.isPending) {
    return <Spinner label={t('state.loading', { ns: 'common' })} />;
  }
  if (accountQuery.isError) {
    return (
      <div className="flex flex-col gap-4">
        {backLink}
        <ErrorAlert
          error={accountQuery.error}
          onRetry={() => {
            void accountQuery.refetch();
          }}
        />
      </div>
    );
  }

  const account = accountQuery.data;
  const allowManage = canManageShares(hasSharePermission, account.myLevel);

  const close = () => {
    setDialog(null);
  };
  const reload = () => {
    void queryClient.invalidateQueries({ queryKey: sharesKeys.list(accountId) });
  };

  const tableStatus = sharesQuery.isPending ? 'loading' : sharesQuery.isError ? 'error' : 'success';

  return (
    <>
      {backLink}
      <PageHeader
        title={t('title', { ns: 'shares', name: account.displayName })}
        description={t('description', { ns: 'shares' })}
        actions={
          allowManage ? (
            <Button
              onClick={() => {
                setDialog({ kind: 'share' });
              }}
            >
              {t('action.share', { ns: 'shares' })}
            </Button>
          ) : undefined
        }
      />
      <SharesTable
        shares={sharesQuery.data ?? []}
        status={tableStatus}
        errorMessage={errorMessage(sharesQuery.error)}
        onRetry={() => {
          void sharesQuery.refetch();
        }}
        timeZone={timeZone}
        canRevoke={allowManage}
        onRevoke={(share) => {
          setDialog({ kind: 'revoke', share });
        }}
      />
      {allowManage ? (
        <ShareAccountDialog
          accountId={accountId}
          open={dialog?.kind === 'share'}
          onOpenChange={(open) => {
            if (!open) close();
          }}
          onShared={(granteeName) => {
            toast.show(t('share.toast', { ns: 'shares', name: granteeName }), 'success');
            close();
            reload();
          }}
        />
      ) : null}
      {dialog?.kind === 'revoke' ? (
        <RevokeShareDialog
          share={dialog.share}
          onClose={close}
          onDone={() => {
            toast.show(
              t('revoke.toast', { ns: 'shares', name: dialog.share.granteeName }),
              'success',
            );
            close();
            reload();
          }}
        />
      ) : null}
    </>
  );
}
