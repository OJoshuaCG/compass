import { Button, Card, EmptyState, Spinner } from '@iam/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import { fetchInboundCodes } from '../api/inbound-api';
import {
  discardExpiredCodes,
  hasValidCode,
  INBOUND_CLIPBOARD_CLEAR_SECONDS,
  INBOUND_COUNTDOWN_TICK_MS,
  shownCodesFrom,
  type ShownCode,
} from '../model/inbound-code-model';
import { InboundCodeItem } from '../ui/inbound-code-item';

const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;

/** Con 403 o 404 reintentar no sirve y los códigos que hubiera en pantalla ya no se deben seguir mostrando. */
function isViewUnavailable(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.status === HTTP_FORBIDDEN || error.status === HTTP_NOT_FOUND)
  );
}

export type InboundCodesPanelProps = {
  viewId: string;
};

/**
 * Códigos vigentes de una vista con su cuenta regresiva. Los valores viven SOLO en el estado de
 * este componente: se piden con `useAsyncAction` (sin Query), no pasan por la URL, el
 * almacenamiento ni la consola, y cada uno se descarta del estado al vencer.
 *
 * El contenedor padre lo monta con `key={viewId}` para que cambiar de vista descarte los códigos.
 */
export function InboundCodesPanel({ viewId }: InboundCodesPanelProps) {
  const { t } = useTranslation(['inbound', 'common']);
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [codes, setCodes] = useState<ShownCode[] | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const action = useAsyncAction(() => fetchInboundCodes(viewId));
  const cooldown = useRateLimitCooldown(action.error);
  // StrictMode ejecuta los efectos dos veces: el cerrojo evita pedir los códigos dos veces al abrir.
  const hasRequestedOnOpenRef = useRef(false);

  async function loadCodes() {
    if (cooldown.secondsLeft > 0) return;
    const result = await action.run();
    if (!result.ok) {
      // Sin acceso o vista inexistente: no se deja en pantalla un código de antes.
      if (isViewUnavailable(result.error)) setCodes(null);
      return;
    }
    const loadedAtMs = Date.now();
    setNowMs(loadedAtMs);
    // Un código que ya llega vencido (reloj desfasado o respuesta lenta) no se pinta como vigente.
    setCodes(discardExpiredCodes(shownCodesFrom(result.value), loadedAtMs));
  }

  useEffect(() => {
    if (hasRequestedOnOpenRef.current) return;
    hasRequestedOnOpenRef.current = true;
    void loadCodes();
    // Solo al abrir: las recargas posteriores salen del botón «Actualizar».
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `loadCodes` se llama una sola vez, aquí.
  }, []);

  const hasLiveCodes = codes !== null && hasValidCode(codes, nowMs);
  useEffect(() => {
    if (!hasLiveCodes) return;
    const timer = window.setInterval(() => {
      const tickMs = Date.now();
      setNowMs(tickMs);
      setCodes((current) => (current === null ? current : discardExpiredCodes(current, tickMs)));
    }, INBOUND_COUNTDOWN_TICK_MS);
    // Al desmontar se cancela el temporizador y los códigos se descartan con el estado.
    return () => {
      window.clearInterval(timer);
    };
  }, [hasLiveCodes]);

  // Un error deja el botón en carga o deshabilitado: el foco vuelve al encabezado, que siempre
  // está montado. El aviso del error se anuncia con role="alert".
  useEffect(() => {
    if (action.error !== undefined) headingRef.current?.focus();
  }, [action.error]);

  const unavailable = isViewUnavailable(action.error);

  return (
    <Card aria-labelledby={headingId} className="flex flex-col gap-4 p-5">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg text-text">
        {t('codes.heading', { ns: 'inbound' })}
      </h2>
      <p className="text-sm text-text-secondary">{t('codes.description', { ns: 'inbound' })}</p>
      {action.error !== undefined ? (
        <ErrorAlert
          error={action.error}
          secondsLeft={cooldown.secondsLeft}
          {...(unavailable
            ? {}
            : {
                onRetry: () => {
                  void loadCodes();
                },
              })}
        />
      ) : null}
      {codes === null && action.pending ? (
        <div className="flex items-center gap-3 text-sm text-text-secondary">
          <Spinner label={t('codes.loading', { ns: 'inbound' })} />
          <span aria-hidden="true">{t('codes.loading', { ns: 'inbound' })}</span>
        </div>
      ) : null}
      {codes !== null && codes.length === 0 ? (
        <EmptyState
          title={t('codes.empty.title', { ns: 'inbound' })}
          description={t('codes.empty.description', { ns: 'inbound' })}
        />
      ) : null}
      {codes !== null && codes.length > 0 ? (
        <ul className="flex flex-col gap-4">
          {codes.map((code, index) => (
            <li key={code.itemId}>
              <InboundCodeItem code={code} position={index + 1} nowMs={nowMs} />
            </li>
          ))}
        </ul>
      ) : null}
      {hasLiveCodes ? (
        <p className="text-sm text-text-secondary">
          {t('codes.clipboardNote', { ns: 'inbound', seconds: INBOUND_CLIPBOARD_CLEAR_SECONDS })}
        </p>
      ) : null}
      {unavailable ? null : (
        <div className="flex justify-end">
          <Button
            variant="secondary"
            loading={action.pending}
            disabled={cooldown.secondsLeft > 0}
            onClick={() => {
              void loadCodes();
            }}
          >
            {t('codes.refresh', { ns: 'inbound' })}
          </Button>
        </div>
      )}
    </Card>
  );
}
