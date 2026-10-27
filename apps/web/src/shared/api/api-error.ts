// TODO(contracts): cuando @iam/contracts exporte un tipo de error de cliente, reemplazar
// esta clase; hoy solo exporta el esquema de Problem Details, que se reutiliza abajo.
import { problemDetailsSchema, type FieldError, type ProblemDetails } from '@iam/contracts';

/** Código local para fallos sin respuesta HTTP (red caída, CORS, aborto). */
export const NETWORK_ERROR_CODE = 'NETWORK';

/** Código de respaldo por estado HTTP cuando el cuerpo no es Problem Details válido. */
function fallbackCode(status: number): string {
  switch (status) {
    case 401:
      return 'AUTHZ.SESSION';
    case 403:
      return 'AUTHZ.PERMISSION';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT.VERSION';
    case 422:
      return 'VALIDATION.FAILED';
    case 429:
      return 'RATE_LIMITED';
    default:
      return 'INTERNAL';
  }
}

/**
 * Error tipado derivado de Problem Details (RFC 9457). `code` es la clave de traducción;
 * `requestId` se muestra al usuario para soporte. Nunca guarda el cuerpo crudo.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  readonly fieldErrors: readonly FieldError[];
  /** Segundos de espera que pidió el servidor (`Retry-After`) en un 429. */
  readonly retryAfterSeconds: number | undefined;

  constructor(init: {
    status: number;
    code: string;
    title: string;
    requestId?: string | undefined;
    fieldErrors?: readonly FieldError[] | undefined;
    retryAfterSeconds?: number | undefined;
  }) {
    super(init.title);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId;
    this.fieldErrors = init.fieldErrors ?? [];
    this.retryAfterSeconds = init.retryAfterSeconds;
  }

  static fromProblem(problem: ProblemDetails, retryAfterSeconds?: number): ApiError {
    return new ApiError({
      retryAfterSeconds,
      status: problem.status,
      code: problem.code,
      title: problem.title,
      requestId: problem.requestId,
      fieldErrors: problem.errors,
    });
  }

  /** Construye el error desde el cuerpo de una respuesta no exitosa, sin confiar en su forma. */
  static fromResponseBody(status: number, body: unknown, retryAfterSeconds?: number): ApiError {
    const parsed = problemDetailsSchema.safeParse(body);
    if (parsed.success) return ApiError.fromProblem(parsed.data, retryAfterSeconds);
    return new ApiError({
      status,
      code: fallbackCode(status),
      title: `HTTP ${String(status)}`,
      retryAfterSeconds,
    });
  }

  static network(): ApiError {
    return new ApiError({ status: 0, code: NETWORK_ERROR_CODE, title: 'Network error' });
  }
}
