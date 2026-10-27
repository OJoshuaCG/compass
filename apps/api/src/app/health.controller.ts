import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  /** Liveness: el proceso responde. La readiness (base de datos, KMS) se añade con sus adaptadores. */
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
