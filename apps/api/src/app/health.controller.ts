import { Controller, Get } from '@nestjs/common';

import { Public } from '../shared/http/http-decorators.js';

@Controller('health')
export class HealthController {
  /** Liveness: el proceso responde. La readiness (base de datos, KMS) se añade con sus adaptadores. */
  // Pública: la consulta un balanceador de carga sin sesión; no expone nada.
  @Public()
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
