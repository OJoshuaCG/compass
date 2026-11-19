import { describe, expect, it, vi } from 'vitest';

import {
  GuardedBackchannelLogoutSender,
  type BackchannelHttpClient,
} from './guarded-backchannel-logout-sender.js';

type SendResult = Awaited<ReturnType<BackchannelHttpClient['send']>>;

const clientReturning = (result: SendResult) => ({ send: vi.fn(() => Promise.resolve(result)) });
const REQUEST = { url: 'https://app.example.com/logout', logoutToken: 'a.b.c' };

describe('GuardedBackchannelLogoutSender', () => {
  it('envía el logout_token como formulario por el cliente público', async () => {
    const publicClient = clientReturning({ ok: true, status: 200 });
    const privateClient = clientReturning({ ok: true, status: 200 });
    const sender = new GuardedBackchannelLogoutSender(publicClient, privateClient);
    expect(await sender.send({ ...REQUEST, allowPrivateNetwork: false })).toEqual({ ok: true });
    expect(publicClient.send).toHaveBeenCalledWith({
      url: REQUEST.url,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-store' },
      body: 'logout_token=a.b.c',
    });
    expect(privateClient.send).not.toHaveBeenCalled();
  });

  it('un cliente con red privada permitida usa el segundo guardia', async () => {
    const publicClient = clientReturning({ ok: true, status: 204 });
    const privateClient = clientReturning({ ok: true, status: 204 });
    const sender = new GuardedBackchannelLogoutSender(publicClient, privateClient);
    await sender.send({ ...REQUEST, allowPrivateNetwork: true });
    expect(privateClient.send).toHaveBeenCalledTimes(1);
    expect(publicClient.send).not.toHaveBeenCalled();
  });

  it.each([
    [{ ok: false, code: 'HOST_UNRESOLVED' }, true],
    [{ ok: false, code: 'TIMEOUT' }, true],
    [{ ok: false, code: 'NETWORK_ERROR' }, true],
    [{ ok: false, code: 'HOST_NOT_ALLOWED' }, false],
    [{ ok: false, code: 'SCHEME_NOT_ALLOWED' }, false],
    [{ ok: false, code: 'REDIRECT_REFUSED' }, false],
    [{ ok: true, status: 500 }, true],
    [{ ok: true, status: 503 }, true],
    [{ ok: true, status: 429 }, true],
    [{ ok: true, status: 408 }, true],
    [{ ok: true, status: 400 }, false],
    [{ ok: true, status: 404 }, false],
  ] as const)('%j → reintentable=%s', async (result, retryable) => {
    const sender = new GuardedBackchannelLogoutSender(
      clientReturning(result),
      clientReturning(result),
    );
    expect(await sender.send({ ...REQUEST, allowPrivateNetwork: false })).toEqual({
      ok: false,
      retryable,
    });
  });
});
