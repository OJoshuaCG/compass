import { useEffect, useState } from 'react';

import { loadWebAuthn } from '../../../shared/lib/webauthn';

/**
 * ¿Admite este navegador WebAuthn? `undefined` mientras se averigua. La biblioteca se descarga
 * aquí, en el fragmento de la ruta `/security`, y no en el JavaScript inicial.
 */
export function useWebAuthnSupport(): boolean | undefined {
  const [supported, setSupported] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    let active = true;
    loadWebAuthn().then(
      (library) => {
        if (active) setSupported(library.browserSupportsWebAuthn());
      },
      () => {
        if (active) setSupported(false);
      },
    );
    return () => {
      active = false;
    };
  }, []);
  return supported;
}
