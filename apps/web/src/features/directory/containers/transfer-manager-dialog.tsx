import type { ManagedUser } from '@iam/contracts';
import { Button, Dialog, RadioGroup, SearchInput, Spinner } from '@iam/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAsyncAction } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import { useDebouncedCommit } from '../../../shared/lib';
import { directoryKeys } from '../api/directory-api';
import { fetchManagerCandidates, teamApi } from '../api/team-api';
import { managerCandidates } from '../model/team-actions';

export type TransferManagerDialogProps = {
  person: ManagedUser;
  onClose: () => void;
  onDone: (message: string) => void;
};

function TransferManagerForm({ person, onClose, onDone }: TransferManagerDialogProps) {
  const { t } = useTranslation(['directory', 'common']);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useDebouncedCommit(query, setQuery);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const action = useAsyncAction((managerId: string) =>
    teamApi.transferManager(person.id, managerId),
  );

  // Se busca en el directorio visible; la lista solo muestra a quienes tienen rango superior.
  const candidates = useQuery({
    queryKey: directoryKeys.managerCandidates(query),
    queryFn: ({ signal }) => fetchManagerCandidates(query, signal),
    staleTime: 30_000,
  });
  const eligible = managerCandidates(candidates.data?.data ?? [], person);

  async function submit() {
    if (selected === undefined) return;
    const result = await action.run(selected);
    if (result.ok) {
      onDone(t('team.toast.transferred', { ns: 'directory', name: person.displayName }));
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-4"
    >
      {action.error !== undefined ? <ErrorAlert error={action.error} /> : null}
      <SearchInput
        label={t('transfer.search', { ns: 'directory' })}
        clearLabel={t('search.clear', { ns: 'common' })}
        placeholder={t('search.placeholder', { ns: 'common' })}
        value={draft}
        onValueChange={setDraft}
      />
      {candidates.isError ? (
        <ErrorAlert
          error={candidates.error}
          onRetry={() => {
            void candidates.refetch();
          }}
        />
      ) : null}
      {candidates.isPending ? (
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <Spinner label={t('transfer.loading', { ns: 'directory' })} />
          <span aria-hidden="true">{t('transfer.loading', { ns: 'directory' })}</span>
        </div>
      ) : null}
      {candidates.data !== undefined && eligible.length === 0 ? (
        <p className="text-sm text-text-secondary">{t('transfer.empty', { ns: 'directory' })}</p>
      ) : null}
      {eligible.length > 0 ? (
        <RadioGroup
          legend={t('transfer.legend', { ns: 'directory' })}
          className="max-h-64 overflow-y-auto"
          options={eligible.map((candidate) => ({
            value: candidate.id,
            label: candidate.displayName,
            description: `${candidate.email} · ${t(`rank.${String(candidate.rank)}`, { ns: 'common' })}`,
          }))}
          value={selected}
          onValueChange={setSelected}
        />
      ) : null}
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose}>
          {t('actions.cancel', { ns: 'common' })}
        </Button>
        <Button type="submit" loading={action.pending} disabled={selected === undefined}>
          {t('transfer.submit', { ns: 'directory' })}
        </Button>
      </div>
    </form>
  );
}

/** Diálogo "Transferir responsable": busca en el directorio y elige a alguien de rango superior. */
export function TransferManagerDialog(props: TransferManagerDialogProps) {
  const { t } = useTranslation(['directory', 'common']);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      title={t('transfer.title', { ns: 'directory' })}
      description={t('transfer.description', { ns: 'directory', name: props.person.displayName })}
      closeLabel={t('dialog.close', { ns: 'common' })}
    >
      <TransferManagerForm {...props} />
    </Dialog>
  );
}
