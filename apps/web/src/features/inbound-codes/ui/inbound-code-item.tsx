import { Card, CodeInput, CopyButton, FormField } from '@iam/ui';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import {
  INBOUND_CLIPBOARD_CLEAR_MS,
  secondsLeftOf,
  type ShownCode,
} from '../model/inbound-code-model';

export type InboundCodeItemProps = {
  code: ShownCode;
  /** Posición (desde 1) en la lista: distingue los controles de varios códigos para lectores de pantalla. */
  position: number;
  nowMs: number;
};

/**
 * Un código con su vencimiento visible. Presentacional: recibe el valor por props y no lo guarda.
 * Vencido, el valor desaparece y la fila lo dice con texto.
 */
export function InboundCodeItem({ code, position, nowMs }: InboundCodeItemProps) {
  const { t } = useTranslation(['inbound', 'common']);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  // Si la persona tenía el foco en esta fila, al vencer el botón de copiar se desmonta y el foco
  // se perdería en <body>: se lleva al aviso de vencido (WCAG 2.4.3).
  const rowHadFocusRef = useRef(false);
  const codeValue = code.code;
  const isShown = codeValue !== null;

  useEffect(() => {
    if (isShown || !rowHadFocusRef.current) return;
    rowHadFocusRef.current = false;
    noticeRef.current?.focus();
  }, [isShown]);

  if (codeValue === null) {
    return (
      // Párrafo y no Alert: el foco ya lo anuncia cuando corresponde; un role="alert" lo repetiría
      // por cada código que vence solo.
      <p
        ref={noticeRef}
        tabIndex={-1}
        className="rounded-md border border-border-strong bg-raised px-4 py-3 text-sm text-text"
      >
        {t('codes.expired', { ns: 'inbound', position })}
      </p>
    );
  }

  const secondsLeft = secondsLeftOf(code, nowMs);
  return (
    <Card
      className="flex flex-col gap-3 bg-raised p-4"
      onFocus={() => {
        rowHadFocusRef.current = true;
      }}
      onBlur={(event) => {
        // Al desmontarse el botón enfocado el navegador puede disparar blur: no cuenta como salida.
        if (event.target.isConnected) rowHadFocusRef.current = false;
      }}
    >
      <FormField label={t('codes.item', { ns: 'inbound', position })}>
        {(controlProps) => (
          <CodeInput
            {...controlProps}
            readOnly
            length={codeValue.length}
            value={codeValue}
            onValueChange={() => undefined}
            className="text-xl text-accent"
          />
        )}
      </FormField>
      {/* aria-live="off": la cuenta regresiva se actualiza cada segundo sin anunciarse. Solo lleva
          texto fijo y segundos, nunca el valor del código. */}
      <p
        role="timer"
        aria-live="off"
        className="font-mono text-sm text-text-secondary tabular-nums"
      >
        {t('codes.expiresIn', { ns: 'inbound', seconds: secondsLeft })}
      </p>
      <div className="flex justify-end">
        <CopyButton
          value={codeValue}
          label={t('codes.copy', { ns: 'inbound', position })}
          copiedLabel={t('clipboard.copied', { ns: 'common' })}
          failedLabel={t('clipboard.failed', { ns: 'common' })}
          clearAfterMs={INBOUND_CLIPBOARD_CLEAR_MS}
        />
      </div>
    </Card>
  );
}
