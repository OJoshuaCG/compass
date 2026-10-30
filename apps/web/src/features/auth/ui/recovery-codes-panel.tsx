import { Button, Checkbox, ConfirmDialog, CopyButton } from '@iam/ui';
import { useBlocker } from '@tanstack/react-router';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

const CLIPBOARD_CLEAR_MS = 30_000;
// Nombre fijo y neutro: no lleva correo, nombre ni fecha que identifique a la persona.
const DOWNLOAD_FILE_NAME = 'recovery-codes.txt';

// La descarga se resuelve de forma asíncrona: Firefox y Safari pueden leer el Blob después de que
// `click()` regresa, y revocar antes cancelaría o vaciaría el archivo de códigos que solo se ven
// una vez. La URL es de un solo origen e inadivinable, así que unos segundos de vida no la exponen.
const BLOB_URL_REVOKE_DELAY_MS = 5000;

/**
 * Dispara la descarga del archivo generado en el navegador. La URL del Blob se revoca tras un
 * retardo corto (también si `click()` lanza) para que los códigos no queden accesibles desde una
 * URL viva; no se guarda nada en almacenamiento ni en caché.
 */
function downloadTextFile(fileName: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, BLOB_URL_REVOKE_DELAY_MS);
    link.remove();
  }
}

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

  // Solo encabezado genérico, advertencia y códigos (uno por línea): sin datos personales.
  function handleDownload() {
    const fileContent = [
      t('enroll.recovery.file.header', { ns: 'auth' }),
      t('enroll.recovery.file.warning', { ns: 'auth' }),
      '',
      ...codes,
      '',
    ].join('\n');
    downloadTextFile(DOWNLOAD_FILE_NAME, fileContent);
  }

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
      <div className="flex flex-wrap items-center gap-2">
        <CopyButton
          value={codes.join('\n')}
          label={t('enroll.recovery.copyAll', { ns: 'auth' })}
          copiedLabel={t('clipboard.copied', { ns: 'common' })}
          failedLabel={t('clipboard.failed', { ns: 'common' })}
          clearAfterMs={CLIPBOARD_CLEAR_MS}
          size="sm"
        />
        {/* Descargar no marca "Ya los guardé": la persona confirma por su cuenta que los guardó. */}
        <Button variant="secondary" size="sm" onClick={handleDownload}>
          {t('enroll.recovery.download', { ns: 'auth' })}
        </Button>
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
