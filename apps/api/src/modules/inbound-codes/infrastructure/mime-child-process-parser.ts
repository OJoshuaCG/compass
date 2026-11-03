import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MimeParseError,
  type MimeParser,
  type ParsedMail,
} from '../application/ports/mime-and-authenticity.js';
import type { SerializedParsedMail } from './mime-parse-core.js';

const PARSE_TIMEOUT_MS = 10_000;
/** La salida es un resumen de texto de un mensaje de a lo sumo 256 KB; más que esto no es legítimo. */
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const CHILD_MAX_HEAP_MB = 128;

export interface ChildProcessCommand {
  readonly executable: string;
  readonly args: readonly string[];
}

/**
 * Banderas del modelo de permisos de Node: con `--permission` el hijo no tiene red, ni procesos hijos, ni
 * hilos, ni complementos nativos, y solo lee las rutas que se le conceden. Un fallo del analizador que
 * ejecute código del remitente no alcanza `/proc/<padre>/environ`, archivos `.env` ni sockets de la API.
 */
export function sandboxArgs(readablePaths: readonly string[]): string[] {
  return [
    `--max-old-space-size=${String(CHILD_MAX_HEAP_MB)}`,
    '--permission',
    ...readablePaths.map((readablePath) => `--allow-fs-read=${readablePath}`),
  ];
}

/**
 * Rutas que el resolvedor de módulos de Node lee al buscar `postal-mime` desde el
 * trabajador: el de cada carpeta ancestro (tipo de módulo) y el enlace `node_modules/postal-mime` de cada una (Node
 * resuelve el enlace a su ruta real). Se conceden uno a uno, y no la carpeta de la aplicación, que contiene `.env` y otros archivos sensibles.
 */
function resolverReadablePaths(workerDirectory: string): string[] {
  const paths: string[] = [];
  let directory = workerDirectory;
  for (;;) {
    paths.push(join(directory, 'package.json'));
    paths.push(join(directory, 'node_modules', 'postal-mime'));
    const parent = dirname(directory);
    if (parent === directory) return paths;
    directory = parent;
  }
}

/** En producción el trabajador es el JavaScript compilado junto a este archivo. */
export function defaultWorkerCommand(): ChildProcessCommand {
  const workerPath = fileURLToPath(new URL('./mime-parse-worker.js', import.meta.url));
  const workerDirectory = dirname(workerPath);
  // Raíz del paquete del analizador (`<raíz>/dist/esm/postal-mime.js`), ya resuelta a su ruta real.
  const parserPackageRoot = dirname(
    dirname(dirname(fileURLToPath(import.meta.resolve('postal-mime')))),
  );
  return {
    executable: process.execPath,
    args: [
      ...sandboxArgs([
        workerDirectory,
        parserPackageRoot,
        ...resolverReadablePaths(workerDirectory),
      ]),
      workerPath,
    ],
  };
}

/**
 * Analiza el correo en un proceso hijo aislado: sin variables de entorno (no hereda contraseñas ni
 * credenciales del padre), con memoria acotada y con un tiempo máximo tras el cual se mata. Cualquier fallo
 * (código de salida, salida inválida, tiempo, exceso de salida) es `MimeParseError`.
 */
export class ChildProcessMimeParser implements MimeParser {
  constructor(
    private readonly command: ChildProcessCommand = defaultWorkerCommand(),
    private readonly timeoutMs: number = PARSE_TIMEOUT_MS,
  ) {}

  parse(rawMessage: Uint8Array): Promise<ParsedMail> {
    return new Promise<ParsedMail>((resolve, reject) => {
      let child: ChildProcessByStdio<Writable, Readable, null>;
      try {
        child = spawn(this.command.executable, [...this.command.args], {
          env: {},
          stdio: ['pipe', 'pipe', 'ignore'],
        });
      } catch {
        // `spawn` puede lanzar de forma síncrona (argumentos demasiado largos, ruta inválida).
        reject(new MimeParseError());
        return;
      }

      const outputChunks: Buffer[] = [];
      let outputBytes = 0;
      let settled = false;

      const finish = (outcome: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        outcome();
      };
      const fail = (): void => {
        finish(() => {
          child.kill('SIGKILL');
          reject(new MimeParseError());
        });
      };
      const timer = setTimeout(fail, this.timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > MAX_OUTPUT_BYTES) {
          fail();
          return;
        }
        outputChunks.push(chunk);
      });
      child.on('error', fail);
      // Si el hijo muere antes de leer todo, escribir en su stdin da EPIPE; el cierre ya lo reporta.
      child.stdin.on('error', () => undefined);
      child.on('close', (exitCode) => {
        if (exitCode !== 0) {
          fail();
          return;
        }
        finish(() => {
          try {
            resolve(deserialize(JSON.parse(Buffer.concat(outputChunks).toString('utf8'))));
          } catch {
            reject(new MimeParseError());
          }
        });
      });

      child.stdin.end(rawMessage);
    });
  }
}

const MAX_BODY_TEXT_CHARACTERS = 512 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * El hijo procesa contenido hostil: su salida se trata como entrada no confiable. Cada campo se valida y
 * se copia a un objeto nuevo (sin propagar campos extra); lo que no cuadre es `MimeParseError`, nunca un
 * `TypeError` tardío dentro de la compuerta DKIM.
 */
function deserialize(value: unknown): ParsedMail {
  if (!isRecord(value)) throw new MimeParseError();
  const {
    fromAddress,
    toAddresses,
    subject,
    dateHeader,
    headerInstanceCounts,
    relevantHeaders,
    bodyText,
  } = value as Partial<Record<keyof SerializedParsedMail, unknown>>;

  if (
    !isNullableString(fromAddress) ||
    !isNullableString(subject) ||
    !isNullableString(dateHeader) ||
    typeof bodyText !== 'string' ||
    bodyText.length > MAX_BODY_TEXT_CHARACTERS ||
    !Array.isArray(toAddresses) ||
    !toAddresses.every((address): address is string => typeof address === 'string') ||
    !Array.isArray(relevantHeaders) ||
    !isRecord(headerInstanceCounts) ||
    !isCount(headerInstanceCounts['from']) ||
    !isCount(headerInstanceCounts['to']) ||
    !isCount(headerInstanceCounts['subject']) ||
    !isCount(headerInstanceCounts['date'])
  ) {
    throw new MimeParseError();
  }

  const headers = relevantHeaders.map((header: unknown) => {
    if (
      !isRecord(header) ||
      typeof header['name'] !== 'string' ||
      typeof header['value'] !== 'string' ||
      !isCount(header['position'])
    ) {
      throw new MimeParseError();
    }
    return { name: header['name'], value: header['value'], position: header['position'] };
  });

  const parsedDate = dateHeader === null ? null : new Date(dateHeader);
  if (parsedDate !== null && Number.isNaN(parsedDate.getTime())) throw new MimeParseError();

  return {
    fromAddress,
    toAddresses,
    subject,
    dateHeader: parsedDate,
    headerInstanceCounts: {
      from: headerInstanceCounts['from'],
      to: headerInstanceCounts['to'],
      subject: headerInstanceCounts['subject'],
      date: headerInstanceCounts['date'],
    },
    relevantHeaders: headers,
    bodyText,
  };
}
