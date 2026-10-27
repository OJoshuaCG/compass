import {
  changeRankRequestSchema,
  type ChangeRankRequest,
  type ManagedUser,
  type Rank,
} from '@iam/contracts';
import { Button, Dialog, FormField, NativeSelect } from '@iam/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert, useValidationMessage } from '../../../shared/i18n';
import { teamApi } from '../api/team-api';
import { assignableRanks } from '../model/team-actions';

export type ChangeRankDialogProps = {
  person: ManagedUser;
  actorRank: Rank;
  onClose: () => void;
  onDone: (message: string) => void;
};

function ChangeRankForm({ person, actorRank, onClose, onDone }: ChangeRankDialogProps) {
  const { t } = useTranslation(['directory', 'common']);
  const validationMessage = useValidationMessage();
  // Si no hubiera opciones (la acción ya se oculta antes) se ofrecen todas: decide el servidor.
  const assignable = assignableRanks(actorRank, person.rank);
  const options = assignable.length > 0 ? assignable : ([1, 2, 3] as const);
  // La reautenticación la gestiona el cliente HTTP: abre su diálogo y reintenta UNA vez.
  const action = useAsyncAction((rank: ChangeRankRequest['rank']) =>
    teamApi.changeRank(person.id, rank),
  );
  const cooldown = useRateLimitCooldown(action.error);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ChangeRankRequest>({
    resolver: zodResolver(changeRankRequestSchema),
    // Por defecto, el rango de menor autoridad: el privilegio mínimo es la opción segura.
    defaultValues: { rank: options.at(-1) ?? 3 },
  });

  async function submit({ rank }: ChangeRankRequest) {
    const result = await action.run(rank);
    if (result.ok) {
      onDone(
        t('team.toast.rankChanged', {
          ns: 'directory',
          name: person.displayName,
          rank: t(`rank.${String(rank)}`, { ns: 'common' }),
        }),
      );
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        void handleSubmit(submit)(event);
      }}
      className="flex flex-col gap-4"
    >
      {action.error !== undefined ? (
        <ErrorAlert error={action.error} secondsLeft={cooldown.secondsLeft} />
      ) : null}
      <FormField
        label={t('rank.label', { ns: 'directory' })}
        required
        error={validationMessage(errors.rank, { field: 'rank' })}
      >
        {(field) => (
          <NativeSelect
            {...field}
            {...register('rank', { valueAsNumber: true })}
            invalid={field['aria-invalid'] === true}
          >
            {options.map((rank) => (
              <option key={rank} value={rank}>
                {t(`rank.${String(rank)}`, { ns: 'common' })}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose}>
          {t('actions.cancel', { ns: 'common' })}
        </Button>
        <Button type="submit" loading={action.pending} disabled={cooldown.secondsLeft > 0}>
          {t('rank.submit', { ns: 'directory' })}
        </Button>
      </div>
    </form>
  );
}

/** Diálogo "Cambiar rango": solo rangos con menos autoridad que el actor y distintos del actual. */
export function ChangeRankDialog(props: ChangeRankDialogProps) {
  const { t } = useTranslation(['directory', 'common']);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      title={t('rank.title', { ns: 'directory' })}
      description={t('rank.description', { ns: 'directory', name: props.person.displayName })}
      closeLabel={t('dialog.close', { ns: 'common' })}
    >
      <ChangeRankForm {...props} />
    </Dialog>
  );
}
