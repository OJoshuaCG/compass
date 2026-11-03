import { describe, expect, it } from 'vitest';

import { NetworkGuard, isPublicAddress, parseAllowedNetwork } from './network-guard.js';

const BLOCKED_IPV4 = [
  '0.0.0.0',
  '0.1.2.3',
  '10.0.0.1',
  '10.255.255.255',
  '100.64.0.1',
  '100.127.255.254',
  '127.0.0.1',
  '127.255.255.255',
  '169.254.169.254',
  '172.16.0.1',
  '172.31.255.255',
  '192.0.0.8',
  '192.0.2.10',
  '192.88.99.1',
  '192.168.1.1',
  '198.18.0.1',
  '198.19.255.255',
  '198.51.100.7',
  '203.0.113.9',
  '224.0.0.1',
  '239.255.255.255',
  '240.0.0.1',
  '255.255.255.255',
];

const PUBLIC_IPV4 = [
  '8.8.8.8',
  '1.1.1.1',
  '100.63.255.255',
  '100.128.0.1',
  '172.15.255.255',
  '172.32.0.1',
  '169.253.255.255',
  '192.0.1.1',
  '198.17.255.255',
  '198.20.0.1',
  '223.255.255.255',
  '192.88.98.255',
  '192.88.100.0',
  '198.51.99.255',
  '198.51.101.0',
  '203.0.112.255',
  '203.0.114.0',
];

const BLOCKED_IPV6 = [
  '::',
  '::1',
  '::2',
  '::192.168.1.1',
  '::ffff:10.0.0.1',
  '::ffff:127.0.0.1',
  '::ffff:169.254.169.254',
  '::ffff:a00:1',
  '64:ff9b::808:808',
  '64:ff9b:1::1',
  'fc00::1',
  'fd12:3456:789a::1',
  'fe80::1',
  'febf::1',
  'fec0::1',
  'ff02::1',
  '2002:c0a8:101::1',
  '2001::1',
  '2001:db8::1',
  '2001:10::1',
  '100::1',
  '3fff::1',
  '3fff:fff:ffff::1',
  '2001:0:4136:e378:8000:63bf:3fff:fdd2',
  '2001:1f::1',
  '2001:1ff::1',
  '2001:db8:ffff::1',
];

const PUBLIC_IPV6 = [
  '2606:4700:4700::1111',
  '2a00:1450:4001:81b::200e',
  '::ffff:8.8.8.8',
  '2001:4860:4860::8888',
  '2001:200::1',
  '2001:db9::1',
  '3fff:1000::1',
  '3ffe::1',
];

describe('isPublicAddress', () => {
  it.each(BLOCKED_IPV4)('rejects the reserved IPv4 %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(PUBLIC_IPV4)('accepts the public IPv4 %s (edge of a blocked range)', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each(BLOCKED_IPV6)('rejects the non-public IPv6 %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(PUBLIC_IPV6)('accepts the public IPv6 %s', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    '',
    'imap.example.test',
    '1.2.3',
    '1.2.3.4.5',
    '256.1.1.1',
    'fe80::1%eth0',
    '::g',
    '1::2::3',
  ])('rejects text that is not an IP address: %j', (text) => {
    expect(isPublicAddress(text)).toBe(false);
  });
});

describe('parseAllowedNetwork', () => {
  it('reads an exact IP as a full-length prefix and a CIDR block as given', () => {
    expect(parseAllowedNetwork('10.1.2.3')?.prefixLength).toBe(32);
    expect(parseAllowedNetwork('10.1.0.0/16')?.prefixLength).toBe(16);
    expect(parseAllowedNetwork('fd00:1:2::/48')?.prefixLength).toBe(48);
  });

  it.each(['', 'host.example.test', '10.0.0.0/33', '10.0.0.0/x', '10.0.0.0/16/8', 'fd00::/129'])(
    'ignores an unreadable entry: %j',
    (entry) => {
      expect(parseAllowedNetwork(entry)).toBeNull();
    },
  );

  it.each(['0.0.0.0/0', '10.0.0.0/8', '10.0.0.0/15', '::/0', 'fd00::/32', 'fd00::/47'])(
    'ignores a block broader than the minimum prefix: %j',
    (entry) => {
      expect(parseAllowedNetwork(entry)).toBeNull();
    },
  );

  it.each([
    '127.0.0.1',
    '127.0.0.0/16',
    '169.254.169.254',
    '169.254.0.0/16',
    '0.0.0.5',
    '224.0.0.1',
    '240.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'ff02::1',
  ])('never admits loopback, link-local, unspecified or multicast: %j', (entry) => {
    expect(parseAllowedNetwork(entry)).toBeNull();
  });

  it('admits the narrowest private blocks at their minimum prefix', () => {
    expect(parseAllowedNetwork('10.0.0.0/16')).not.toBeNull();
    expect(parseAllowedNetwork('192.168.0.0/24')).not.toBeNull();
  });
});

describe('NetworkGuard', () => {
  function guardFor(addresses: readonly string[] | Error, allowed: readonly string[] = []) {
    const lookups: string[] = [];
    const guard = new NetworkGuard((host) => {
      lookups.push(host);
      return addresses instanceof Error ? Promise.reject(addresses) : Promise.resolve(addresses);
    }, allowed);
    return { guard, lookups };
  }

  it('returns the first address when every record is public', async () => {
    const { guard } = guardFor(['8.8.8.8', '2606:4700:4700::1111']);

    await expect(guard.resolve('imap.example.test')).resolves.toEqual({
      ok: true,
      address: '8.8.8.8',
    });
  });

  it('rejects the whole name when any record is not public (rebinding by mixed records)', async () => {
    const { guard } = guardFor(['8.8.8.8', '169.254.169.254']);

    await expect(guard.resolve('imap.example.test')).resolves.toEqual({
      ok: false,
      code: 'HOST_NOT_ALLOWED',
    });
  });

  it('rejects an IPv6 record that embeds a private IPv4', async () => {
    const { guard } = guardFor(['2606:4700:4700::1111', '::ffff:10.0.0.5']);

    await expect(guard.resolve('imap.example.test')).resolves.toMatchObject({ ok: false });
  });

  it('reports an unresolved name for an empty answer and for a resolver error', async () => {
    await expect(guardFor([]).guard.resolve('imap.example.test')).resolves.toEqual({
      ok: false,
      code: 'HOST_UNRESOLVED',
    });
    await expect(
      guardFor(new Error('ENOTFOUND detalle interno')).guard.resolve('x.test'),
    ).resolves.toEqual({
      ok: false,
      code: 'HOST_UNRESOLVED',
    });
  });

  it('validates an IP literal without resolving it', async () => {
    const blocked = guardFor(['8.8.8.8']);
    await expect(blocked.guard.resolve('127.0.0.1')).resolves.toMatchObject({ ok: false });
    expect(blocked.lookups).toEqual([]);

    const allowed = guardFor([]);
    await expect(allowed.guard.resolve('8.8.4.4')).resolves.toEqual({
      ok: true,
      address: '8.8.4.4',
    });
  });

  it('admits a private server only when the deployment lists it', async () => {
    await expect(guardFor(['10.1.2.3']).guard.resolve('imap.interno.test')).resolves.toMatchObject({
      ok: false,
    });
    await expect(
      guardFor(['10.1.2.3'], ['10.1.2.0/24']).guard.resolve('imap.interno.test'),
    ).resolves.toEqual({ ok: true, address: '10.1.2.3' });
    await expect(
      guardFor(['10.1.3.3'], ['10.1.2.0/24']).guard.resolve('imap.interno.test'),
    ).resolves.toMatchObject({ ok: false });
  });

  it('does not let an exception cover a different record of the same name', async () => {
    const { guard } = guardFor(['10.1.2.3', '169.254.169.254'], ['10.1.2.3']);

    await expect(guard.resolve('imap.interno.test')).resolves.toMatchObject({ ok: false });
  });

  it('ignores an unreadable exception instead of opening everything', async () => {
    const { guard } = guardFor(['10.1.2.3'], ['no-es-una-red', '0.0.0.0/x']);

    await expect(guard.resolve('imap.interno.test')).resolves.toMatchObject({ ok: false });
  });

  it('compares an IPv4-mapped IPv6 record with the IPv4 exception that covers it', async () => {
    const { guard } = guardFor(['::ffff:10.1.2.3'], ['10.1.2.0/24']);

    await expect(guard.resolve('imap.interno.test')).resolves.toEqual({
      ok: true,
      address: '::ffff:10.1.2.3',
    });
  });

  it('admits a private IPv6 server only by its exception', async () => {
    await expect(guardFor(['fd00:1:2::5']).guard.resolve('v6.interno.test')).resolves.toMatchObject(
      {
        ok: false,
      },
    );
    await expect(
      guardFor(['fd00:1:2::5'], ['fd00:1:2::/48']).guard.resolve('v6.interno.test'),
    ).resolves.toMatchObject({ ok: true });
  });

  it('does not let an over-broad exception open the guard', async () => {
    await expect(
      guardFor(['169.254.169.254'], ['0.0.0.0/0']).guard.resolve('x.test'),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      guardFor(['127.0.0.1'], ['127.0.0.1', '10.0.0.0/8']).guard.resolve('x.test'),
    ).resolves.toMatchObject({ ok: false });
  });

  it.each(['127.1', '0x7f.1', '2130706433', '010.0.0.1', '[::1]', 'localhost'])(
    'rejects an alternative loopback spelling returned by the resolver: %j',
    async (spelling) => {
      const { guard } = guardFor([spelling]);

      await expect(guard.resolve('imap.example.test')).resolves.toMatchObject({ ok: false });
    },
  );
});
