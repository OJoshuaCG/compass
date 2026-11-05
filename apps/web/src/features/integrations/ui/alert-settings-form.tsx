import type { InfrastructureAlertChannels } from '@iam/contracts';
import { Button, Checkbox } from '@iam/ui';
import { useId } from 'react';

export type AlertSettingsFormLabels = {
  legend: string;
  emailLabel: string;
  emailDescription: string;
  telegramLabel: string;
  telegramDescription: string;
  save: string;
};

export type AlertSettingsFormProps = {
  channels: InfrastructureAlertChannels;
  labels: AlertSettingsFormLabels;
  /** Motivo ya traducido por el que no se puede guardar; su presencia deshabilita el envío. */
  blockedReason: string | undefined;
  saving: boolean;
  /** Segundos de espera por un 429 (deshabilita el envío sin cambiar el texto). */
  cooldownSeconds: number;
  onChange: (channels: InfrastructureAlertChannels) => void;
  onSubmit: () => void;
};

type ChannelRowProps = {
  label: string;
  description: string;
  checked: boolean;
  describedBy: string | undefined;
  onToggle: (checked: boolean) => void;
};

function ChannelRow({ label, description, checked, describedBy, onToggle }: ChannelRowProps) {
  const id = useId();
  const descriptionId = `${id}-description`;
  return (
    <div className="flex items-start gap-3">
      <Checkbox
        id={id}
        checked={checked}
        aria-describedby={[descriptionId, describedBy].filter(Boolean).join(' ')}
        onChange={(event) => {
          onToggle(event.target.checked);
        }}
      />
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="text-sm font-medium text-text">
          {label}
        </label>
        <p id={descriptionId} className="text-sm text-text-secondary">
          {description}
        </p>
      </div>
    </div>
  );
}

/**
 * Casillas de los canales de aviso y botón de guardar. Presentacional: no sabe de HTTP ni de
 * permisos. El motivo del bloqueo se enlaza con `aria-describedby` porque un botón deshabilitado
 * no recibe foco y, sin el enlace, un lector de pantalla no sabría por qué no responde.
 */
export function AlertSettingsForm({
  channels,
  labels,
  blockedReason,
  saving,
  cooldownSeconds,
  onChange,
  onSubmit,
}: AlertSettingsFormProps) {
  const reasonId = useId();
  const reasonLink = blockedReason === undefined ? undefined : reasonId;
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="flex flex-col gap-4"
    >
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-base font-medium text-text">{labels.legend}</legend>
        <ChannelRow
          label={labels.emailLabel}
          description={labels.emailDescription}
          checked={channels.email}
          describedBy={reasonLink}
          onToggle={(email) => {
            onChange({ ...channels, email });
          }}
        />
        <ChannelRow
          label={labels.telegramLabel}
          description={labels.telegramDescription}
          checked={channels.telegram}
          describedBy={reasonLink}
          onToggle={(telegram) => {
            onChange({ ...channels, telegram });
          }}
        />
      </fieldset>
      {blockedReason !== undefined ? (
        <p id={reasonId} role="alert" className="text-sm text-danger">
          {blockedReason}
        </p>
      ) : null}
      <div>
        <Button
          type="submit"
          loading={saving}
          disabled={blockedReason !== undefined || cooldownSeconds > 0}
          aria-describedby={reasonLink}
        >
          {labels.save}
        </Button>
      </div>
    </form>
  );
}
