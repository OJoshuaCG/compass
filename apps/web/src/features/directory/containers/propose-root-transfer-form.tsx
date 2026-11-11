import type { DirectoryUser, RootTransfer } from '@iam/contracts';
import { Button, RadioGroup } from '@iam/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import { proposeRootTransfer } from '../api/root-transfer-api';

export type ProposeRootTransferFormProps = {
  /** Administradores a quienes se puede proponer el puesto (ya sin quien propone). */
  candidates: readonly DirectoryUser[];
  /** Éxito: el padre guarda la transferencia abierta y avisa. */
  onProposed: (transfer: RootTransfer, targetName: string) => void;
};

/**
 * Formulario con el que la Raíz propone el puesto a un Administrador. La reautenticación reciente
 * la abre el cliente HTTP base y reintenta una vez; aquí solo se elige a la persona.
 */
export function ProposeRootTransferForm({ candidates, onProposed }: ProposeRootTransferFormProps) {
  const { t } = useTranslation(['directory']);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const action = useAsyncAction((targetUserId: string) => proposeRootTransfer({ targetUserId }));
  const cooldown = useRateLimitCooldown(action.error);

  if (candidates.length === 0) {
    return <p className="text-sm text-text-secondary">{t('rootTransfer.propose.empty')}</p>;
  }

  async function submit() {
    if (selectedId === undefined) return;
    const result = await action.run(selectedId);
    if (!result.ok) return;
    const target = candidates.find((candidate) => candidate.id === selectedId);
    onProposed(result.value, target?.displayName ?? '');
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
      {action.error !== undefined ? (
        <ErrorAlert error={action.error} secondsLeft={cooldown.secondsLeft} />
      ) : null}
      <RadioGroup
        legend={t('rootTransfer.propose.legend')}
        className="max-h-64 overflow-y-auto"
        options={candidates.map((candidate) => ({
          value: candidate.id,
          label: candidate.displayName,
          description: candidate.email,
        }))}
        value={selectedId}
        onValueChange={setSelectedId}
      />
      <div className="flex justify-end">
        <Button
          type="submit"
          loading={action.pending}
          disabled={selectedId === undefined || cooldown.secondsLeft > 0}
        >
          {t('rootTransfer.propose.submit')}
        </Button>
      </div>
    </form>
  );
}
