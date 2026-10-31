import { importCredentialsRequestSchema } from '@iam/contracts';
import type {
  CredentialImportPreview,
  CredentialImportResult,
  FieldError,
  ImportCredentialsRequest,
} from '@iam/contracts';
import { Body, Controller, Header, HttpCode, Post } from '@nestjs/common';

import { unwrap } from '../../../shared/http/http-decorators.js';
import { RequestValidationError } from '../../../shared/http/request-validation-error.js';
import { ZodValidationPipe } from '../../../shared/http/zod-validation.pipe.js';
import { ImportCredentials } from '../application/import-credentials.js';

/** Las respuestas se derivan de un archivo con secretos: ningún caché debe guardarlas. */
const NO_STORE = 'no-store';

const importBodyPipe = new ZodValidationPipe(importCredentialsRequestSchema);

/**
 * Importación por CSV (B7). El archivo viaja como texto en `csv` y solo vive en memoria.
 * Sin `@Idempotent()`: el cuerpo lleva contraseñas y la caché de idempotencia las guardaría.
 * El cuerpo nunca se registra: la API no registra cuerpos de petición.
 */
@Controller('credentials/import')
export class CredentialImportController {
  constructor(private readonly importCredentials: ImportCredentials) {}

  /** Previsualización: valida y clasifica cada fila sin escribir nada. */
  @Header('Cache-Control', NO_STORE)
  @HttpCode(200)
  @Post('preview')
  async preview(
    @Body(importBodyPipe) body: ImportCredentialsRequest,
  ): Promise<CredentialImportPreview> {
    return unwrap(await this.importCredentials.preview(body.csv));
  }

  /** Confirmación: todo o nada. Con filas inválidas responde 422 con el código de cada fila. */
  @Header('Cache-Control', NO_STORE)
  @Post()
  async commit(
    @Body(importBodyPipe) body: ImportCredentialsRequest,
  ): Promise<CredentialImportResult> {
    const outcome = unwrap(await this.importCredentials.commit(body.csv));
    if (outcome.status === 'rejected') {
      const errors: FieldError[] = outcome.preview.rows.flatMap((row) =>
        row.errorCodes.map((code) => ({ field: `line.${String(row.line)}`, code })),
      );
      throw new RequestValidationError(errors);
    }
    return outcome.result;
  }
}
