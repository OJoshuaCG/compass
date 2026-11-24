import { describe, expect, it, vi } from 'vitest';

import { BackchannelLogoutError } from '../domain/backchannel-logout.js';
import type { OidcClientRecord } from '../domain/oidc-client.js';
import type { LogoutTokenSigner } from './ports/logout-token-signer.js';
import type { BackchannelLogoutOutcome } from './ports/backchannel-logout-sender.js';
import { SendBackchannelLogout } from './send-backchannel-logout.js';

const NOW = new Date('2026-11-19T10:00:00.000Z');
const PAYLOAD = { clientId: 'app-1', sid: 'sid-1' };

const client = (overrides: Partial<OidcClientRecord> = {}): OidcClientRecord => ({
  id: 'c1',
  clientId: 'app-1',
  name: 'App',
  redirectUris: [],
  postLogoutRedirectUris: [],
  backchannelLogoutUri: 'https://app.example.com/logout',
  allowPrivateNetworkBackchannel: false,
  allowRefreshTokens: false,
  refreshJustification: null,
  isExternal: false,
  maxRank: null,
  status: 'active',
  createdAt: NOW,
  ...overrides,
});

function build(options: {
  client?: OidcClientRecord | null;
  outcome?: BackchannelLogoutOutcome;
  delivered?: boolean;
}) {
  const sign = vi.fn<LogoutTokenSigner['sign']>(() => Promise.resolve('signed.jwt'));
  const send = vi.fn(() => Promise.resolve(options.outcome ?? { ok: true as const }));
  const markDelivered = vi.fn(() => Promise.resolve());
  const handler = new SendBackchannelLogout({
    issuer: 'https://compass.example.com',
    clients: {
      findActiveByClientId: () =>
        Promise.resolve(options.client === undefined ? client() : options.client),
    },
    signer: { sign },
    sender: { send },
    deliveries: { wasDelivered: () => Promise.resolve(options.delivered ?? false), markDelivered },
    ids: { next: () => 'jti-1' },
    clock: { now: () => NOW },
  });
  return { handler, sign, send, markDelivered };
}

describe('SendBackchannelLogout', () => {
  it('firma un logout_token con sid, sin nonce, y lo envía a la URI del cliente', async () => {
    const { handler, sign, send, markDelivered } = build({});
    await handler.handle({ eventId: 'e1', payload: PAYLOAD });
    const iat = Math.floor(NOW.getTime() / 1000);
    expect(sign).toHaveBeenCalledWith({
      iss: 'https://compass.example.com',
      aud: 'app-1',
      iat,
      exp: iat + 120,
      jti: 'jti-1',
      sid: 'sid-1',
      events: { 'http://schemas.openid.net/event/backchannel-logout': {} },
    });
    expect(send).toHaveBeenCalledWith({
      url: 'https://app.example.com/logout',
      logoutToken: 'signed.jwt',
      allowPrivateNetwork: false,
    });
    expect(markDelivered).toHaveBeenCalledWith('e1', 'backchannel:app-1:sid-1');
  });

  it('pasa la marca de red privada del cliente al envío', async () => {
    const { handler, send } = build({ client: client({ allowPrivateNetworkBackchannel: true }) });
    await handler.handle({ eventId: 'e1', payload: PAYLOAD });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ allowPrivateNetwork: true }));
  });

  it('no reenvía un aviso ya acusado', async () => {
    const { handler, send } = build({ delivered: true });
    await handler.handle({ eventId: 'e1', payload: PAYLOAD });
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ['un cliente inexistente o deshabilitado', null],
    ['un cliente sin backchannel_logout_uri', client({ backchannelLogoutUri: null })],
  ])('no hay a quién avisar con %s: termina sin error ni envío', async (_name, found) => {
    const { handler, send, markDelivered } = build({ client: found });
    await handler.handle({ eventId: 'e1', payload: PAYLOAD });
    expect(send).not.toHaveBeenCalled();
    expect(markDelivered).not.toHaveBeenCalled();
  });

  it.each([
    ['una falla transitoria', true],
    ['un rechazo permanente', false],
  ])('%s lanza un error con retryable acorde y sin acusar', async (_name, retryable) => {
    const { handler, markDelivered } = build({ outcome: { ok: false, retryable } });
    await expect(handler.handle({ eventId: 'e1', payload: PAYLOAD })).rejects.toMatchObject({
      name: 'BackchannelLogoutError',
      retryable,
    });
    expect(markDelivered).not.toHaveBeenCalled();
  });

  it('un payload con forma inválida es un error NO reintentable', async () => {
    const { handler, send } = build({});
    const failure: unknown = await handler.handle({ eventId: 'e1', payload: { clientId: 1 } }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(BackchannelLogoutError);
    expect((failure as BackchannelLogoutError).retryable).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
