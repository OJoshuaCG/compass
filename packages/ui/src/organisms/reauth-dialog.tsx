import { useState, type SyntheticEvent } from 'react';

import { Button } from '../atoms/button';
import { Alert } from '../molecules/alert';
import { CodeInput } from '../molecules/code-input';
import { Dialog } from '../molecules/dialog';
import { FormField } from '../molecules/form-field';

export type ReauthDialogLabels = {
  title: string;
  description: string;
  codeLabel: string;
  submit: string;
  cancel: string;
  close: string;
};

/** Alternativa al código: reautenticar con una llave de acceso (ADR 0033). */
export type ReauthDialogPasskey = {
  label: string;
  onUse: () => void;
  loading?: boolean;
};

export type ReauthDialogProps = {
  open: boolean;
  labels: ReauthDialogLabels;
  /** Envía el código. El llamador decide qué hacer con el resultado. */
  onSubmit: (code: string) => void;
  /** Cierra sin reautenticar (botón, Escape o cierre del diálogo). */
  onCancel: () => void;
  loading?: boolean;
  /** Mensaje de error ya traducido (código inválido, límite de intentos...). */
  errorMessage?: string | undefined;
  /** Segundos de espera tras un 429: mantiene el envío deshabilitado. */
  cooldownLabel?: string | undefined;
  disabled?: boolean;
  /** Si se indica, ofrece la llave de acceso además del código; la ceremonia la gestiona el llamador. */
  passkey?: ReauthDialogPasskey | undefined;
};

const CODE_LENGTH = 6;

function ReauthForm({
  labels,
  onSubmit,
  onCancel,
  loading,
  errorMessage,
  cooldownLabel,
  disabled,
  passkey,
}: Omit<ReauthDialogProps, 'open'>) {
  // El código vive solo aquí y se descarta al cerrar: Radix desmonta el contenido.
  const [code, setCode] = useState('');
  const complete = code.length === CODE_LENGTH;

  function handleSubmit(event: SyntheticEvent) {
    event.preventDefault();
    if (complete && disabled !== true) onSubmit(code);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      {errorMessage !== undefined ? <Alert tone="danger">{errorMessage}</Alert> : null}
      {cooldownLabel !== undefined ? <Alert tone="warning">{cooldownLabel}</Alert> : null}
      <FormField label={labels.codeLabel} required>
        {(control) => (
          <CodeInput
            {...control}
            invalid={control['aria-invalid'] === true}
            value={code}
            onValueChange={setCode}
            length={CODE_LENGTH}
            // El diálogo existe para esto: el foco va directo al campo.
            autoFocus
          />
        )}
      </FormField>
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onCancel}>
          {labels.cancel}
        </Button>
        <Button type="submit" loading={loading === true} disabled={!complete || disabled === true}>
          {labels.submit}
        </Button>
      </div>
      {passkey !== undefined ? (
        <Button
          variant="secondary"
          onClick={passkey.onUse}
          loading={passkey.loading === true}
          disabled={disabled === true}
        >
          {passkey.label}
        </Button>
      ) : null}
    </form>
  );
}

/**
 * Diálogo de reautenticación (step-up): pide un código TOTP o, si se ofrece, una llave de acceso. Presentacional: no llama a la
 * API; quien lo usa envía el código, reintenta la operación y cierra (docs/frontend.md §7.2).
 */
export function ReauthDialog({ open, labels, onCancel, ...form }: ReauthDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title={labels.title}
      description={labels.description}
      closeLabel={labels.close}
    >
      <ReauthForm labels={labels} onCancel={onCancel} {...form} />
    </Dialog>
  );
}
