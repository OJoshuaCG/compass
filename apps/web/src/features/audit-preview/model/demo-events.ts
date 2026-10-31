import type { FetchPage, Page, PageParams } from '../../../shared/api';

/**
 * Vista previa de la auditoría (solo desarrollo): eventos ficticios con la forma aproximada que
 * tendrá la lectura de auditoría (tarea R1). No hay API: nada de esto sale del navegador. Los
 * nombres, cuentas y motivos son datos de ejemplo del prototipo; las frases son claves de i18n.
 */

export const AUDIT_TYPES = ['reveal', 'totp', 'share', 'people', 'session', 'denied'] as const;
export type AuditType = (typeof AUDIT_TYPES)[number];

/** Filtro de tipo: `all` o uno de los tipos. */
export const AUDIT_TYPE_FILTERS = ['all', ...AUDIT_TYPES] as const;
export type AuditTypeFilter = (typeof AUDIT_TYPE_FILTERS)[number];

export const AUDIT_RANGES = ['24h', '7d', '30d'] as const;
export type AuditRange = (typeof AUDIT_RANGES)[number];

const RANGE_MINUTES: Record<AuditRange, number> = {
  '24h': 24 * 60,
  '7d': 7 * 24 * 60,
  '30d': 30 * 24 * 60,
};

export type AuditAction =
  | 'revealed'
  | 'revealBlocked'
  | 'totpIssued'
  | 'jitApproved'
  | 'passkeyLogin'
  | 'loginFailed'
  | 'invited'
  | 'deactivated'
  | 'sharedWithGroup'
  | 'otherSessionsClosed';

export type AuditNote = 'revealLimit' | 'manager' | 'rotationTasks' | 'sessionsClosed';

export type DemoAuditEvent = {
  id: string;
  type: AuditType;
  /** `null`: no se pudo identificar a la persona (por ejemplo, un inicio de sesión fallido). */
  actor: string | null;
  action: AuditAction;
  actionParams?: Record<string, string | number>;
  /** Objeto sobre el que se actuó (dato, no se traduce). */
  object: string;
  /** Aclaración traducible que acompaña al objeto. */
  note?: { key: AuditNote; params: Record<string, string | number> };
  /** Antigüedad respecto del momento de la consulta. */
  minutesAgo: number;
  result: 'allowed' | 'denied';
  /** Motivo declarado por la persona (dato, no se traduce). */
  reason?: string;
  /** Navegador, sistema y dirección de red (dato). */
  origin: string;
  hash: string;
};

/** Total ficticio de la cadena, como el prototipo. */
export const DEMO_CHAIN_TOTAL = 18204;

/** Mismos eventos que el prototipo. Función (no constante) para que el bundler la descarte. */
export function createDemoEvents(): DemoAuditEvent[] {
  return [
    {
      id: 'evt_e1',
      type: 'reveal',
      actor: 'Sofía Ramírez',
      action: 'revealed',
      object: 'Instagram · Marca MX · Acceso principal',
      minutesAgo: 18,
      result: 'allowed',
      reason: 'Recuperar acceso tras cambio de dispositivo',
      origin: 'Chrome · macOS · 189.203.40.2',
      hash: 'a91f07c2e8d4b31f6a0e95c7d2b84f13c0e',
    },
    {
      id: 'evt_e2',
      type: 'denied',
      actor: 'Carlos Vega',
      action: 'revealBlocked',
      object: 'X · Soporte',
      note: { key: 'revealLimit', params: { count: 31, limit: 30 } },
      minutesAgo: 45,
      result: 'denied',
      reason: 'Revisar credenciales del equipo',
      origin: 'Firefox · Windows · 189.203.40.7',
      hash: '3be4f1a0c97d2e58b6f04a9c1d3e7b2918c',
    },
    {
      id: 'evt_e3',
      type: 'totp',
      actor: 'Diego Torres',
      action: 'totpIssued',
      object: 'Instagram · Marca MX',
      minutesAgo: 105,
      result: 'allowed',
      origin: 'Safari · iOS · 189.203.40.11',
      hash: '77b2c9e0f4a13d86b5e2c07f9a41d6e3e104',
    },
    {
      id: 'evt_e4',
      type: 'share',
      actor: 'Luis García',
      action: 'jitApproved',
      actionParams: { hours: 4, level: 'USE' },
      object: 'TikTok · Marca MX → Diego Torres',
      minutesAgo: 118,
      result: 'allowed',
      origin: 'Chrome · macOS · 189.203.40.2',
      hash: 'c51e8a7f02b9d43e6c1a5f80b7d29e4c3a71',
    },
    {
      id: 'evt_e5',
      type: 'session',
      actor: 'Luis García',
      action: 'passkeyLogin',
      object: 'Chrome · macOS',
      minutesAgo: 133,
      result: 'allowed',
      origin: 'Ciudad de México · 189.203.40.2',
      hash: '9d02f6b1e4c83a57d0b9e2f16c4a8d7305be',
    },
    {
      id: 'evt_e6',
      type: 'denied',
      actor: null,
      action: 'loginFailed',
      actionParams: { count: 3 },
      object: 'mariana.ortiz@inbtel.com',
      minutesAgo: 22 * 60,
      result: 'denied',
      origin: 'IP 189.203.44.17',
      hash: 'e3a8b60c1f5d97e24a8c3b0f6d2e91a711d2',
    },
    {
      id: 'evt_e7',
      type: 'people',
      actor: 'Luis García',
      action: 'invited',
      actionParams: { name: 'Mariana Ortiz' },
      object: 'mariana.ortiz@inbtel.com',
      note: { key: 'manager', params: { name: 'Luis García' } },
      minutesAgo: 26 * 60,
      result: 'allowed',
      origin: 'Chrome · macOS · 189.203.40.2',
      hash: '0c4d7e2a9b6f13c85d0a4e7b2f9c61d89a7f',
    },
    {
      id: 'evt_e8',
      type: 'people',
      actor: 'Luis García',
      action: 'deactivated',
      actionParams: { name: 'Andrea Núñez' },
      object: 'andrea.nunez@inbtel.com',
      note: { key: 'rotationTasks', params: { count: 2 } },
      minutesAgo: 28 * 60,
      result: 'allowed',
      reason: 'Fin de contrato',
      origin: 'Chrome · macOS · 189.203.40.2',
      hash: '5f90a3d7c2e18b46f9d0c5a2e7b31f04c6b3',
    },
    {
      id: 'evt_e9',
      type: 'reveal',
      actor: 'Andrea Núñez',
      action: 'revealed',
      object: 'X · Soporte · Acceso principal',
      minutesAgo: 34 * 60,
      result: 'allowed',
      reason: 'Responder mensajes directos pendientes',
      origin: 'Edge · Windows · 189.203.40.15',
      hash: 'b2e1c07f4a9d36e85b1c0a7f2d94e6b304aa',
    },
    {
      id: 'evt_e10',
      type: 'share',
      actor: 'Luis García',
      action: 'sharedWithGroup',
      actionParams: { level: 'USE' },
      object: 'YouTube · Canal Marca → Redes Marca MX',
      minutesAgo: 4 * 24 * 60,
      result: 'allowed',
      origin: 'Chrome · macOS · 189.203.40.2',
      hash: '6a7d2f9c0e1b45a83f6d9c2e0b7a15f4d8e2',
    },
    {
      id: 'evt_e11',
      type: 'totp',
      actor: 'Sofía Ramírez',
      action: 'totpIssued',
      object: 'Facebook · Página Marca MX',
      minutesAgo: 6 * 24 * 60,
      result: 'allowed',
      origin: 'Chrome · macOS · 189.203.40.9',
      hash: 'd84b1e6f2a0c97d35e8b4f1a6c0d29e7b5c1',
    },
    {
      id: 'evt_e12',
      type: 'session',
      actor: 'Sofía Ramírez',
      action: 'otherSessionsClosed',
      object: 'Chrome · macOS',
      note: { key: 'sessionsClosed', params: { count: 2 } },
      minutesAgo: 10 * 24 * 60,
      result: 'allowed',
      origin: 'Ciudad de México · 189.203.40.9',
      hash: '1f3c9e7a5d2b08f46c1e9a3d7b5f20c8e6a4',
    },
  ];
}

/** Hash del evento anterior en la cadena (el siguiente más antiguo de la lista), como el prototipo. */
export function previousHash(event: DemoAuditEvent, events = createDemoEvents()): string | null {
  const index = events.findIndex((candidate) => candidate.id === event.id);
  return events[index + 1]?.hash ?? null;
}

/** Eventos dentro del periodo: es la base de los conteos por tipo. */
export function eventsInRange(events: DemoAuditEvent[], range: AuditRange): DemoAuditEvent[] {
  return events.filter((event) => event.minutesAgo <= RANGE_MINUTES[range]);
}

/** Conteo por tipo dentro del periodo (sin aplicar la búsqueda ni el filtro de tipo). */
export function countByType(
  events: DemoAuditEvent[],
  range: AuditRange,
): Record<AuditTypeFilter, number> {
  const base = eventsInRange(events, range);
  const counts = { all: base.length } as Record<AuditTypeFilter, number>;
  for (const type of AUDIT_TYPES) {
    counts[type] = base.filter((event) => event.type === type).length;
  }
  return counts;
}

/** Periodo, tipo y búsqueda por persona, objeto o motivo (sin distinguir mayúsculas). */
export function filterEvents(
  events: DemoAuditEvent[],
  type: AuditTypeFilter,
  range: AuditRange,
  query: string | undefined,
): DemoAuditEvent[] {
  const q = query?.trim().toLowerCase() ?? '';
  return eventsInRange(events, range).filter(
    (event) =>
      (type === 'all' || event.type === type) &&
      (q === '' ||
        [event.actor ?? '', event.object, event.reason ?? ''].some((field) =>
          field.toLowerCase().includes(q),
        )),
  );
}

/**
 * Simula la futura lectura paginada de auditoría con el contrato de listados (`{ data, page }`,
 * cursor opaco): filtra y pagina en memoria, del más reciente al más antiguo, con una latencia
 * pequeña para ver la carga.
 */
export function createDemoAuditFetcher(
  type: AuditTypeFilter,
  range: AuditRange,
  events: DemoAuditEvent[] = createDemoEvents(),
  delayMs = 150,
): FetchPage<DemoAuditEvent> {
  return async (params: PageParams, signal: AbortSignal): Promise<Page<DemoAuditEvent>> => {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delayMs);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });
    const sorted = [...filterEvents(events, type, range, params.q)].sort(
      (a, b) => a.minutesAgo - b.minutesAgo,
    );
    const offset = params.cursor === undefined ? 0 : Number(params.cursor);
    const end = offset + params.limit;
    return {
      data: sorted.slice(offset, end),
      page: {
        nextCursor: end < sorted.length ? String(end) : null,
        limit: params.limit,
        total: sorted.length,
      },
    };
  };
}
