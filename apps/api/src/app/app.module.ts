import { Module } from '@nestjs/common';
import type { DynamicModule, Provider } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { ListDirectory } from '../modules/directory/index.js';
import { UsersController } from '../modules/directory/interface/users.controller.js';
import {
  AcceptInvitation,
  CreateInvitation,
  GetProfile,
  Login,
  Logout,
  PreviewInvitation,
  SecondFactor,
  SessionService,
} from '../modules/identity/index.js';
import { AuthController, MeController } from '../modules/identity/interface/auth.controller.js';
import { InvitationsController } from '../modules/identity/interface/invitations.controller.js';
import { CsrfGuard } from '../shared/http/csrf.guard.js';
import { RateLimitGuard } from '../shared/http/rate-limit.guard.js';
import {
  REQUEST_CONTEXT_RUNNER,
  RequestContextInterceptor,
} from '../modules/identity/interface/request-context.interceptor.js';
import { SessionGuard } from '../modules/identity/interface/session.guard.js';
import type { Container } from './container.js';
import { HealthController } from './health.controller.js';

@Module({})
export class AppModule {
  /**
   * Sin contenedor solo responde la comprobación de vida (pruebas de cabeceras); con contenedor
   * se montan los controladores de negocio y las guardas globales, en este orden:
   * límite por IP, CSRF y sesión.
   */
  static register(container: Container | null, appOrigin: string): DynamicModule {
    if (container === null) return { module: AppModule, controllers: [HealthController] };

    const providers: Provider[] = [
      { provide: SessionService, useValue: container.sessions },
      { provide: Login, useValue: container.login },
      { provide: Logout, useValue: container.logout },
      { provide: SecondFactor, useValue: container.secondFactor },
      { provide: CreateInvitation, useValue: container.createInvitation },
      { provide: PreviewInvitation, useValue: container.previewInvitation },
      { provide: AcceptInvitation, useValue: container.acceptInvitation },
      { provide: GetProfile, useValue: container.getProfile },
      { provide: ListDirectory, useValue: container.listDirectory },
      { provide: REQUEST_CONTEXT_RUNNER, useValue: container.requestContext },
      { provide: APP_GUARD, useClass: RateLimitGuard },
      { provide: APP_GUARD, useFactory: () => new CsrfGuard(appOrigin) },
      { provide: APP_GUARD, useClass: SessionGuard },
      { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
    ];
    return {
      module: AppModule,
      controllers: [
        HealthController,
        AuthController,
        MeController,
        InvitationsController,
        UsersController,
      ],
      providers,
    };
  }
}
