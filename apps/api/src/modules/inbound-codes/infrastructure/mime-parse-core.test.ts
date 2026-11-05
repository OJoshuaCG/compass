import { describe, expect, it } from 'vitest';

import { parseRawMessage } from './mime-parse-core.js';

function raw(lines: readonly string[]): Uint8Array {
  return new TextEncoder().encode(lines.join('\r\n'));
}

const BASIC = [
  'Authentication-Results: mx.example.test; dkim=pass header.d=banco.test header.s=s1 header.b=abcdef12',
  'Received: from relay.example.test by mx.example.test',
  'DKIM-Signature: v=1; a=rsa-sha256; d=banco.test; s=s1; h=from:to:subject:date; b=abcdef12345',
  'From: Alertas <Alertas@Banco.Test>',
  'To: Codigos <codes@example.test>, Otro <otro@example.test>',
  'Subject: Tu codigo',
  'Date: Mon, 02 Nov 2026 10:05:00 +0000',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Tu codigo es 123456',
];

describe('parseRawMessage', () => {
  it('extracts the sender, recipients, subject, date and plain text', async () => {
    const parsed = await parseRawMessage(raw(BASIC));

    expect(parsed.fromAddress).toBe('alertas@banco.test');
    expect(parsed.toAddresses).toEqual(['codes@example.test', 'otro@example.test']);
    expect(parsed.subject).toBe('Tu codigo');
    expect(parsed.dateHeader).toBe('2026-11-02T10:05:00.000Z');
    expect(parsed.bodyText).toContain('123456');
  });

  it('reports only the authentication headers with their position in the message', async () => {
    const parsed = await parseRawMessage(raw(BASIC));

    expect(parsed.relevantHeaders.map((header) => [header.name, header.position])).toEqual([
      ['authentication-results', 0],
      ['dkim-signature', 2],
    ]);
  });

  it('counts every instance of the headers the DKIM gate compares', async () => {
    const parsed = await parseRawMessage(
      raw([
        'From: a@banco.test',
        'From: b@evil.test',
        'To: codes@example.test',
        'Subject: x',
        'Subject: y',
        'Subject: z',
        '',
        'cuerpo',
      ]),
    );

    expect(parsed.headerInstanceCounts).toEqual({ from: 2, to: 1, subject: 3, date: 0 });
  });

  it('keeps an Authentication-Results planted lower in the message at its own position', async () => {
    const parsed = await parseRawMessage(
      raw([
        'Received: from relay.example.test',
        'Authentication-Results: mx.example.test; dkim=pass header.d=banco.test',
        'From: a@banco.test',
        '',
        'cuerpo',
      ]),
    );

    expect(parsed.relevantHeaders).toEqual([
      expect.objectContaining({ name: 'authentication-results', position: 1 }),
    ]);
  });

  it('returns null and empty values for a message without those headers', async () => {
    const parsed = await parseRawMessage(raw(['X-Otro: 1', '', 'hola']));

    expect(parsed.fromAddress).toBeNull();
    expect(parsed.toAddresses).toEqual([]);
    expect(parsed.subject).toBeNull();
    expect(parsed.dateHeader).toBeNull();
  });

  it('never returns the HTML part as text', async () => {
    const parsed = await parseRawMessage(
      raw([
        'From: a@banco.test',
        'Content-Type: text/html; charset=utf-8',
        '',
        '<p>codigo <b>999999</b></p>',
      ]),
    );

    expect(parsed.bodyText).toBe('');
  });

  it('does not let the hidden text of an HTML sibling part reach the body of a mixed message', async () => {
    const parsed = await parseRawMessage(
      raw([
        'From: a@banco.test',
        'Content-Type: multipart/mixed; boundary=limite',
        '',
        '--limite',
        'Content-Type: text/plain',
        '',
        'hola',
        '--limite',
        'Content-Type: text/html',
        '',
        '<div style="display:none">Tu codigo es 999999</div>',
        '--limite--',
      ]),
    );

    expect(parsed.bodyText).not.toContain('999999');
  });

  it('keeps the plain text of a multipart/alternative message and ignores its HTML alternative', async () => {
    const parsed = await parseRawMessage(
      raw([
        'From: a@banco.test',
        'Content-Type: multipart/alternative; boundary=limite',
        '',
        '--limite',
        'Content-Type: text/plain',
        '',
        'codigo visible 111111',
        '--limite',
        'Content-Type: text/html',
        '',
        '<p>codigo oculto 222222</p>',
        '--limite--',
      ]),
    );

    expect(parsed.bodyText).toContain('111111');
    expect(parsed.bodyText).not.toContain('222222');
  });

  it('reports an unusable From as null and not as an empty string', async () => {
    const parsed = await parseRawMessage(raw(['From: <>', '', 'hola']));

    expect(parsed.fromAddress).toBeNull();
  });

  it('rejects a message with more MIME parts than the cap', async () => {
    const parts = Array.from({ length: 250 }, (_unused, index) => [
      '--limite',
      'Content-Type: text/plain',
      '',
      `parte ${String(index)}`,
    ]).flat();
    const message = raw([
      'From: a@banco.test',
      'Content-Type: multipart/mixed; boundary=limite',
      '',
      ...parts,
      '--limite--',
    ]);

    await expect(parseRawMessage(message)).rejects.toThrow();
  });
});
