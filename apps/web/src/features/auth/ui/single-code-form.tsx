import { mfaVerifyRequestSchema, recoveryCodeRequestSchema } from '@iam/contracts';
import { Button, CodeInput, FormField, Input } from '@iam/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';

import { useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert, useValidationMessage } from '../../../shared/i18n';

export type SingleCodeFormProps = {
  /** `totp`: 6 dígitos del autenticador; `recovery`: código de recuperación alfanumérico. */
  kind: 'totp' | 'recovery';
  label: string;
  submitLabel: string;
  pending: boolean;
  /** Último error de la operación (el container lo conserva); se muestra y, si es 429, bloquea. */
  error: unknown;
  onSubmit: (code: string) => void;
  autoFocus?: boolean;
};

type Values = { code: string };

/**
 * Formulario de un solo código, compartido por la verificación MFA, el código de recuperación y
 * la confirmación del enrolamiento. react-hook-form + el esquema Zod del contrato; el código
 * vive solo en el estado del formulario.
 */
export function SingleCodeForm({
  kind,
  label,
  submitLabel,
  pending,
  error,
  onSubmit,
  autoFocus = true,
}: SingleCodeFormProps) {
  const validationMessage = useValidationMessage();
  const cooldown = useRateLimitCooldown(error);
  const field = kind === 'totp' ? 'code' : 'recoveryCode';
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(kind === 'totp' ? mfaVerifyRequestSchema : recoveryCodeRequestSchema),
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
            error={validationMessage(errors.code, { field, empty: value === '' })}
          >
            {(control) =>
              kind === 'totp' ? (
                <CodeInput
                  {...control}
                  ref={ref}
                  name={name}
                  invalid={control['aria-invalid'] === true}
                  value={value}
                  onValueChange={onChange}
                  onBlur={onBlur}
                  autoFocus={autoFocus}
                />
              ) : (
                <Input
                  {...control}
                  ref={ref}
                  name={name}
                  invalid={control['aria-invalid'] === true}
                  value={value}
                  onChange={(event) => {
                    onChange(event.target.value);
                  }}
                  onBlur={onBlur}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  className="font-mono"
                  autoFocus={autoFocus}
                />
              )
            }
          </FormField>
        )}
      />
      <Button type="submit" loading={pending} disabled={cooldown.secondsLeft > 0}>
        {submitLabel}
      </Button>
    </form>
  );
}
