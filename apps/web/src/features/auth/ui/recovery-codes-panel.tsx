import { Button, Checkbox, ConfirmDialog, CopyButton } from '@iam/ui';
import { useBlocker } from '@tanstack/react-router';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

const CLIPBOARD_CLEAR_MS = 30_000;

export type RecoveryCodesPanelProps = {
  codes: readonly string[];
  /** Se llama solo tras marcar "Ya los guardé"; el padre descarta los códigos de su estado. */
  onContinue: () => void;
};

/**
 * Muestra los códigos de recuperación UNA sola vez. No hay forma de continuar sin confirmar
 * que se guardaron: después de esta pantalla ya no se pueden volver a ver.
 */
export function RecoveryCodesPanel({ codes, onContinue }: RecoveryCodesPanelProps) {
  const { t } = useTranslation(['auth', 'common']);
  const [saved, setSaved] = useState(false);
  const checkboxId = useId();
  const headingId = useId();

  // Mientras los códigos están visibles y no se confirmó que se guardaron, salir los pierde para
  // siempre. Al marcar "Ya los guardé" el bloqueo se deshabilita y no aparece ningún aviso.
  useEffect(() => {
    if (saved) return;
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', warnBeforeUnload);
    };
  }, [saved]);

  // `enableBeforeUnload: false`: el listener de arriba ya cubre cerrar/recargar la pestaña y solo
  // existe mientras aplica; el del historial del navegador es permanente.
  const blocker = useBlocker({
    shouldBlockFn: () => true,
    disabled: saved,
    enableBeforeUnload: false,
    withResolver: true,
  });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-secondary">
        {t('enroll.recovery.description', { ns: 'auth' })}
      </p>
      <h2 id={headingId} className="sr-only">
        {t('enroll.recovery.list', { ns: 'auth' })}
      </h2>
      <ul
        aria-labelledby={headingId}
        className="grid grid-cols-1 gap-2 rounded-md border border-border-strong bg-raised p-4 font-mono text-sm text-text sm:grid-cols-2"
      >
        {codes.map((code) => (
          <li key={code} className="tabular-nums">
            {code}
          </li>
        ))}
      </ul>
      <div>
        <CopyButton
          value={codes.join('\n')}
          label={t('enroll.recovery.copyAll', { ns: 'auth' })}
          copiedLabel={t('clipboard.copied', { ns: 'common' })}
          failedLabel={t('clipboard.failed', { ns: 'common' })}
          clearAfterMs={CLIPBOARD_CLEAR_MS}
          size="sm"
        />
      </div>
      <div className="flex items-center gap-3">
        <Checkbox
          id={checkboxId}
          checked={saved}
          onChange={(event) => {
            setSaved(event.target.checked);
          }}
        />
        <label htmlFor={checkboxId} className="text-sm text-text">
          {t('enroll.recovery.saved', { ns: 'auth' })}
        </label>
      </div>
      <Button disabled={!saved} onClick={onContinue}>
        {t('enroll.recovery.continue', { ns: 'auth' })}
      </Button>
      <ConfirmDialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
        title={t('enroll.recovery.leave.title', { ns: 'auth' })}
        description={t('enroll.recovery.leave.description', { ns: 'auth' })}
        confirmLabel={t('enroll.recovery.leave.confirm', { ns: 'auth' })}
        cancelLabel={t('enroll.recovery.leave.stay', { ns: 'auth' })}
        tone="danger"
        onConfirm={() => {
          blocker.proceed?.();
        }}
      />
    </div>
  );
}
