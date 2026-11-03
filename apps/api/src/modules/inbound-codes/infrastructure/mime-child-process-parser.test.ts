import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { MimeParseError } from '../application/ports/mime-and-authenticity.js';
import {
  ChildProcessMimeParser,
  defaultWorkerCommand,
  sandboxArgs,
} from './mime-child-process-parser.js';

const VALID_RESULT = JSON.stringify({
  fromAddress: 'a@banco.test',
  toAddresses: ['codes@example.test'],
  subject: 'x',
  dateHeader: '2026-11-02T10:05:00.000Z',
  headerInstanceCounts: { from: 1, to: 1, subject: 1, date: 1 },
  relevantHeaders: [],
  bodyText: 'hola',
});

/** Trabajador de juguete: ejecuta un guion de Node en lugar del analizador real. */
function parserRunning(script: string, timeoutMs = 5000): ChildProcessMimeParser {
  return new ChildProcessMimeParser(
    { executable: process.execPath, args: ['-e', script] },
    timeoutMs,
  );
}

const INPUT = new TextEncoder().encode('From: a@banco.test\r\n\r\nhola');

describe('ChildProcessMimeParser', () => {
  it('turns the worker JSON into a parsed mail with a real Date', async () => {
    const parser = parserRunning(`process.stdout.write(${JSON.stringify(VALID_RESULT)})`);

    const parsed = await parser.parse(INPUT);

    expect(parsed.fromAddress).toBe('a@banco.test');
    expect(parsed.dateHeader).toEqual(new Date('2026-11-02T10:05:00.000Z'));
  });

  it('feeds the raw message to the worker through stdin', async () => {
    const parser = parserRunning(`
      const chunks = [];
      process.stdin.on('data', (c) => chunks.push(c));
      process.stdin.on('end', () => {
        const received = Buffer.concat(chunks).toString('utf8');
        const result = ${VALID_RESULT};
        result.bodyText = received;
        process.stdout.write(JSON.stringify(result));
      });
    `);

    const parsed = await parser.parse(INPUT);

    expect(parsed.bodyText).toBe('From: a@banco.test\r\n\r\nhola');
  });

  it('launches the worker with an empty environment', async () => {
    const parser = parserRunning(`
      const result = ${VALID_RESULT};
      result.bodyText = JSON.stringify(Object.keys(process.env).filter((name) => name !== 'PWD' && name !== 'SHLVL' && name !== '_' && name !== 'OLDPWD'));
      process.stdout.write(JSON.stringify(result));
    `);

    const parsed = await parser.parse(INPUT);

    expect(parsed.bodyText).toBe('[]');
  });

  it('does not pass inherited secrets to the worker', async () => {
    process.env['COMPASS_TEST_SECRET'] = 'valor-secreto';
    try {
      const parser = parserRunning(`
        const result = ${VALID_RESULT};
        result.bodyText = String(process.env.COMPASS_TEST_SECRET);
        process.stdout.write(JSON.stringify(result));
      `);

      const parsed = await parser.parse(INPUT);

      expect(parsed.bodyText).toBe('undefined');
    } finally {
      delete process.env['COMPASS_TEST_SECRET'];
    }
  });

  it('fails with MimeParseError when the worker exits with an error code', async () => {
    await expect(parserRunning('process.exit(2)').parse(INPUT)).rejects.toBeInstanceOf(
      MimeParseError,
    );
  });

  it('fails when the worker prints something that is not the expected JSON', async () => {
    await expect(
      parserRunning("process.stdout.write('no es json')").parse(INPUT),
    ).rejects.toBeInstanceOf(MimeParseError);
    await expect(
      parserRunning('process.stdout.write(\'{"a":1}\')').parse(INPUT),
    ).rejects.toBeInstanceOf(MimeParseError);
    await expect(parserRunning("process.stdout.write('null')").parse(INPUT)).rejects.toBeInstanceOf(
      MimeParseError,
    );
  });

  it('kills a worker that does not finish within the time budget', async () => {
    const startedAt = Date.now();

    await expect(
      parserRunning('setInterval(() => undefined, 1000)', 300).parse(INPUT),
    ).rejects.toBeInstanceOf(MimeParseError);
    expect(Date.now() - startedAt).toBeLessThan(4000);
  });

  it('fails when the worker output exceeds the cap', async () => {
    const parser = parserRunning("process.stdout.write('x'.repeat(3 * 1024 * 1024))");

    await expect(parser.parse(INPUT)).rejects.toBeInstanceOf(MimeParseError);
  });

  it('fails when the worker executable does not exist', async () => {
    const parser = new ChildProcessMimeParser({ executable: '/no/existe/worker', args: [] }, 1000);

    await expect(parser.parse(INPUT)).rejects.toBeInstanceOf(MimeParseError);
  });
});

describe('ChildProcessMimeParser output validation', () => {
  function withOverride(overrides: Record<string, unknown>): ChildProcessMimeParser {
    const result = { ...(JSON.parse(VALID_RESULT) as Record<string, unknown>), ...overrides };
    return parserRunning(`process.stdout.write(${JSON.stringify(JSON.stringify(result))})`);
  }

  it.each([
    ['a missing headerInstanceCounts', { headerInstanceCounts: undefined }],
    [
      'a negative instance count',
      { headerInstanceCounts: { from: -1, to: 1, subject: 1, date: 1 } },
    ],
    [
      'a fractional instance count',
      { headerInstanceCounts: { from: 1.5, to: 1, subject: 1, date: 1 } },
    ],
    ['a text instance count', { headerInstanceCounts: { from: '1', to: 1, subject: 1, date: 1 } }],
    ['a numeric subject', { subject: 5 }],
    ['a numeric sender', { fromAddress: 5 }],
    ['a date that is not a date', { dateHeader: 'no es una fecha' }],
    ['a non-string recipient', { toAddresses: ['a@b.test', 7] }],
    ['a header that is not an object', { relevantHeaders: ['texto'] }],
    [
      'a header without a position',
      { relevantHeaders: [{ name: 'dkim-signature', value: 'v=1' }] },
    ],
    [
      'a header with a text position',
      { relevantHeaders: [{ name: 'a', value: 'b', position: '0' }] },
    ],
  ])('rejects %s', async (_label, overrides) => {
    await expect(withOverride(overrides).parse(INPUT)).rejects.toBeInstanceOf(MimeParseError);
  });

  it('rejects an oversized body (generated inside the worker, argv has a size limit)', async () => {
    const parser = parserRunning(`
      const result = ${VALID_RESULT};
      result.bodyText = 'x'.repeat(600 * 1024);
      process.stdout.write(JSON.stringify(result));
    `);

    await expect(parser.parse(INPUT)).rejects.toBeInstanceOf(MimeParseError);
  });

  it('reports a spawn that throws synchronously (arguments too long) as MimeParseError', async () => {
    const parser = parserRunning('x'.repeat(600 * 1024));

    await expect(parser.parse(INPUT)).rejects.toBeInstanceOf(MimeParseError);
  });

  it('does not propagate fields the contract does not define', async () => {
    const parsed = await withOverride({ extra: 'x', __proto__: { polluted: true } }).parse(INPUT);

    expect(Object.keys(parsed).sort()).toEqual([
      'bodyText',
      'dateHeader',
      'fromAddress',
      'headerInstanceCounts',
      'relevantHeaders',
      'subject',
      'toAddresses',
    ]);
  });

  it('accepts a null sender, subject and date', async () => {
    const parsed = await withOverride({ fromAddress: null, subject: null, dateHeader: null }).parse(
      INPUT,
    );

    expect(parsed).toMatchObject({ fromAddress: null, subject: null, dateHeader: null });
  });
});

describe('real MIME worker', () => {
  // Corre el trabajador real desde el código fuente con tsx (el compilado solo existe tras `pnpm build`).
  const WORKER_SOURCE = fileURLToPath(new URL('./mime-parse-worker.ts', import.meta.url));
  const TSX_LOADER = import.meta.resolve('tsx');
  const realWorker = new ChildProcessMimeParser(
    { executable: process.execPath, args: ['--import', TSX_LOADER, WORKER_SOURCE] },
    20_000,
  );

  it('parses a message end to end through stdin and stdout', async () => {
    const message = new TextEncoder().encode(
      [
        'Authentication-Results: mx.example.test; dkim=pass header.d=banco.test',
        'From: Alertas <alertas@banco.test>',
        'To: codes@example.test',
        'Subject: Tu codigo',
        'Date: Mon, 02 Nov 2026 10:05:00 +0000',
        '',
        'Tu codigo es 123456',
      ].join('\r\n'),
    );

    const parsed = await realWorker.parse(message);

    expect(parsed.fromAddress).toBe('alertas@banco.test');
    expect(parsed.dateHeader).toEqual(new Date('2026-11-02T10:05:00.000Z'));
    expect(parsed.relevantHeaders).toEqual([
      expect.objectContaining({ name: 'authentication-results', position: 0 }),
    ]);
    expect(parsed.bodyText).toContain('123456');
  });

  it('reports a hostile message (more MIME parts than the cap) as MimeParseError', async () => {
    const parts = Array.from({ length: 250 }, (_unused, index) =>
      ['--limite', 'Content-Type: text/plain', '', `parte ${String(index)}`].join('\r\n'),
    );
    const message = new TextEncoder().encode(
      [
        'From: a@banco.test',
        'Content-Type: multipart/mixed; boundary=limite',
        '',
        parts.join('\r\n'),
        '--limite--',
      ].join('\r\n'),
    );

    await expect(realWorker.parse(message)).rejects.toBeInstanceOf(MimeParseError);
  });
});

describe('MIME worker sandbox', () => {
  const OUTSIDE_FILE = fileURLToPath(new URL('./network-guard.ts', import.meta.url));

  function sandboxed(script: string): ChildProcessMimeParser {
    return new ChildProcessMimeParser(
      { executable: process.execPath, args: [...sandboxArgs([]), '-e', script] },
      5000,
    );
  }

  /** El guion intenta `action` y devuelve por stdout el resultado como `bodyText` del JSON esperado. */
  function probe(action: string): ChildProcessMimeParser {
    return sandboxed(`
      const result = ${VALID_RESULT};
      (async () => {
        try { ${action}; result.bodyText = 'ALLOWED'; }
        catch (error) { result.bodyText = String(error.code); }
        process.stdout.write(JSON.stringify(result));
      })();
    `);
  }

  it('denies reading files the worker was not granted', async () => {
    const parsed = await probe(
      `require('node:fs').readFileSync(${JSON.stringify(OUTSIDE_FILE)})`,
    ).parse(INPUT);

    expect(parsed.bodyText).toBe('ERR_ACCESS_DENIED');
  });

  it('denies reading the parent process environment', async () => {
    const parsed = await probe(
      `require('node:fs').readFileSync('/proc/' + process.ppid + '/environ')`,
    ).parse(INPUT);

    expect(parsed.bodyText).toBe('ERR_ACCESS_DENIED');
  });

  it('denies spawning processes', async () => {
    const parsed = await probe(`require('node:child_process').execSync('true')`).parse(INPUT);

    expect(parsed.bodyText).toBe('ERR_ACCESS_DENIED');
  });

  it('denies the network', async () => {
    const parsed = await sandboxed(`
      const result = ${VALID_RESULT};
      const socket = require('node:net').connect(9, '127.0.0.1');
      socket.on('connect', () => { socket.destroy(); result.bodyText = 'ALLOWED'; done(); });
      socket.on('error', (error) => { result.bodyText = String(error.code); done(); });
      function done() { process.stdout.write(JSON.stringify(result)); }
    `).parse(INPUT);

    expect(parsed.bodyText).not.toBe('ALLOWED');
  });

  it('launches the production worker with the permission model and no broad grants', () => {
    const { args } = defaultWorkerCommand();

    expect(args).toContain('--permission');
    const grants = args
      .filter((argument) => argument.startsWith('--allow-fs-read='))
      .map((argument) => argument.slice('--allow-fs-read='.length));
    expect(grants.length).toBeGreaterThan(0);
    expect(grants).not.toContain('*');
    expect(grants).not.toContain('/');
    expect(grants.some((grant) => /(^|\/)\.env/.test(grant))).toBe(false);
    expect(args.some((argument) => argument.startsWith('--allow-child-process'))).toBe(false);
    expect(args.some((argument) => argument.startsWith('--allow-net'))).toBe(false);
  });
});
