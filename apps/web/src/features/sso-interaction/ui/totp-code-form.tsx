import { reauthRequestSchema } from '@iam/contracts';
import { Button, CodeInput, FormField } from '@iam/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';

import { useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert, useValidationMessage } from '../../../shared/i18n';

export type TotpCodeFormProps = {
  label: string;
  submitLabel: string;
  pending: boolean;
  /** Último error de la operación; se muestra y, si es 429, bloquea el envío. */
  error: unknown;
  onSubmit: (code: string) => void;
};

type Values = { code: string };

/**
 * Código TOTP de 6 dígitos. react-hook-form + el esquema Zod del contrato; el código vive solo
 * en el estado del formulario. Réplica mínima de `SingleCodeForm` de `features/auth`, que no se
 * puede importar entre features.
 */
export function TotpCodeForm({ label, submitLabel, pending, error, onSubmit }: TotpCodeFormProps) {
  const validationMessage = useValidationMessage();
  const cooldown = useRateLimitCooldown(error);
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(reauthRequestSchema),
    defaultValues: { code: '' },
  });

  return (
    <form
      noValidate
      onSubmit={(event) => {
        void handleSubmit((values) => {
          onSubmit(values.code);
        })(event);
      }}
      className="flex flex-col gap-4"
    >
      {error !== undefined ? <ErrorAlert error={error} secondsLeft={cooldown.secondsLeft} /> : null}
      <Controller
        control={control}
        name="code"
        render={({ field: { value, onChange, onBlur, ref, name } }) => (
          <FormField
            label={label}
            required
            error={validationMessage(errors.code, { field: 'code', empty: value === '' })}
          >
            {(fieldControl) => (
              <CodeInput
                {...fieldControl}
                ref={ref}
                name={name}
                invalid={fieldControl['aria-invalid'] === true}
                value={value}
                onValueChange={onChange}
                onBlur={onBlur}
                autoFocus
              />
            )}
          </FormField>
        )}
      />
      <Button type="submit" loading={pending} disabled={cooldown.secondsLeft > 0}>
        {submitLabel}
      </Button>
    </form>
  );
}
