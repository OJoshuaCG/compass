import type { Group } from '@iam/contracts';
import { Card, CardBody, CardHeader, FormField, NativeSelect, PageHeader, Spinner } from '@iam/ui';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError } from '../../../shared/api';
import { useMe } from '../../../shared/auth';
import { ErrorAlert } from '../../../shared/i18n';
import { useLazyCatalog } from '../../../shared/i18n/use-lazy-catalog';
import { fetchGroups, groupsKeys } from '../../directory';
import {
  credentialHealthSummaryKeys,
  fetchGroupHealthSummary,
  fetchOrganizationHealthSummary,
} from '../api/credential-health-summary-api';
import { CredentialHealthSummaryBody } from '../ui/credential-health-summary-body';

/** Rango máximo (número) que ve el panel de toda la organización: la Raíz y los Administradores. */
const MAX_RANK_TO_SEE_ORGANIZATION_PANEL = 1;

/** Solo un fallo transitorio (red, 429 o 5xx) mejora al repetir; un 403 o un 404 dicen lo mismo. */
function isRetryable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.status === 429 || error.status >= 500;
}

function OrganizationPanel({ title }: { title: string }) {
  const headingId = useId();
  const query = useQuery({
    queryKey: credentialHealthSummaryKeys.organization(),
    queryFn: ({ signal }) => fetchOrganizationHealthSummary(signal),
    staleTime: 0,
    retry: false,
  });
  return (
    <Card aria-labelledby={headingId}>
      <CardHeader>
        <h2 id={headingId} className="text-lg font-semibold text-text">
          {title}
        </h2>
      </CardHeader>
      <CardBody>
        <CredentialHealthSummaryBody
          status={query.status === 'pending' ? 'loading' : query.status}
          summary={query.data}
          error={query.error}
          onRetry={
            isRetryable(query.error)
              ? () => {
                  void query.refetch();
                }
              : undefined
          }
          subject={title}
        />
      </CardBody>
    </Card>
  );
}

function GroupPanel({ group }: { group: Group }) {
  const query = useQuery({
    queryKey: credentialHealthSummaryKeys.group(group.id),
    queryFn: ({ signal }) => fetchGroupHealthSummary(group.id, signal),
    staleTime: 0,
    retry: false,
  });
  return (
    <CredentialHealthSummaryBody
      status={query.status === 'pending' ? 'loading' : query.status}
      summary={query.data}
      error={query.error}
      onRetry={
        isRetryable(query.error)
          ? () => {
              void query.refetch();
            }
          : undefined
      }
      subject={group.name}
    />
  );
}

/**
 * Container de `/credential-health`: salud de las credenciales solo con conteos. El panel de la
 * organización se ofrece a rango 0 y 1; el de un grupo, a quien el servidor deja ver ese grupo.
 * Esto es comodidad de la interfaz: cada consulta la autoriza el servidor.
 */
export function CredentialHealthSummaryPage() {
  const catalogReady = useLazyCatalog('credentials');
  const { t } = useTranslation(['credentials', 'common']);
  const me = useMe();
  const groupHeadingId = useId();
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const groupsQuery = useQuery({
    queryKey: groupsKeys.list(),
    queryFn: ({ signal }) => fetchGroups(signal),
    staleTime: 0,
  });

  if (!catalogReady || me === undefined) {
    return <Spinner label={t('state.loading', { ns: 'common' })} />;
  }

  const showOrganizationPanel = me.user.rank <= MAX_RANK_TO_SEE_ORGANIZATION_PANEL;
  const groups = groupsQuery.data ?? [];
  const selectedGroup = groups.find((group) => group.id === selectedGroupId);

  return (
    <>
      <PageHeader
        eyebrow={t('nav.group.vault', { ns: 'common' })}
        title={t('healthSummary.title')}
        description={t('healthSummary.description')}
      />
      {showOrganizationPanel ? (
        <OrganizationPanel title={t('healthSummary.organization.title')} />
      ) : null}
      <Card aria-labelledby={groupHeadingId}>
        <CardHeader>
          <h2 id={groupHeadingId} className="text-lg font-semibold text-text">
            {t('healthSummary.group.title')}
          </h2>
        </CardHeader>
        <CardBody className="flex flex-col gap-5">
          {groupsQuery.isPending ? (
            <Spinner label={t('state.loading', { ns: 'common' })} />
          ) : groupsQuery.isError ? (
            <ErrorAlert
              error={groupsQuery.error}
              {...(isRetryable(groupsQuery.error)
                ? {
                    onRetry: () => {
                      void groupsQuery.refetch();
                    },
                  }
                : {})}
            />
          ) : groups.length === 0 ? (
            <p className="text-sm text-text-secondary">{t('healthSummary.group.none')}</p>
          ) : (
            <>
              <FormField label={t('healthSummary.group.label')}>
                {(field) => (
                  <NativeSelect
                    {...field}
                    value={selectedGroupId}
                    onChange={(event) => {
                      setSelectedGroupId(event.target.value);
                    }}
                    className="max-w-md"
                  >
                    <option value="">{t('healthSummary.group.placeholder')}</option>
                    {groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
              {selectedGroup === undefined ? (
                <p className="text-sm text-text-secondary">{t('healthSummary.group.choose')}</p>
              ) : (
                // La clave reinicia el panel al cambiar de grupo: nunca se pinta el conteo de otro.
                <GroupPanel key={selectedGroup.id} group={selectedGroup} />
              )}
            </>
          )}
        </CardBody>
      </Card>
    </>
  );
}
