import {
  changeCredentialPasswordRequestSchema,
  createCredentialRequestSchema,
  revealPasswordRequestSchema,
} from '@iam/contracts';
import type {
  ChangeCredentialPasswordRequest,
  CreateCredentialRequest,
  Credential,
  CredentialUsername,
  PasswordVersion,
  RevealPasswordRequest,
  RevealedPassword,
} from '@iam/contracts';
import { Body, Controller, Get, Header, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';

import { unwrap } from '../../../shared/http/http-decorators.js';
import { ZodValidationPipe } from '../../../shared/http/zod-validation.pipe.js';
import { ManageCredentials } from '../application/manage-credentials.js';
import type {
  CredentialRecord,
  PasswordVersionSummary,
} from '../application/ports/credential-repository.js';

/** Respuestas con secretos: ningún caché, ni del navegador ni de un intermediario, debe guardarlas. */
const NO_STORE = 'no-store';

const uuidPipe = new ZodValidationPipe(z.uuid());

/**
 * Número de versión de la ruta: solo dígitos decimales, sin ceros a la izquierda, notación científica ni
 * hexadecimal (`Number('0x10')` sería 16), y dentro del rango de `integer` de la base de datos.
 */
const MAX_VERSION_NUMBER = 2_147_483_647;
const versionPipe = new ZodValidationPipe(
  z
    .string()
    .regex(/^[1-9]\d{0,9}$/)
    .transform(Number)
    .pipe(z.number().int().max(MAX_VERSION_NUMBER)),
);

const toCredential = (credential: CredentialRecord): Credential => ({
  id: credential.id,
  accountId: credential.accountId,
  label: credential.label,
  kind: credential.kind,
  lastRotatedAt: credential.lastRotatedAt === null ? null : credential.lastRotatedAt.toISOString(),
  createdAt: credential.createdAt.toISOString(),
});

const toPasswordVersion = (version: PasswordVersionSummary): PasswordVersion => ({
  version: version.version,
  isCurrent: version.isCurrent,
  createdAt: version.createdAt.toISOString(),
  createdBy: version.createdBy,
});

@Controller('accounts/:accountId/credentials')
export class AccountCredentialsController {
  constructor(private readonly manageCredentials: ManageCredentials) {}

  @Get()
  async list(@Param('accountId', uuidPipe) accountId: string): Promise<{ data: Credential[] }> {
    const credentials = unwrap(await this.manageCredentials.listForAccount(accountId));
    return { data: credentials.map(toCredential) };
  }

  // Sin `@Idempotent()`: el cuerpo lleva la contraseña y la caché de idempotencia la guardaría.
  @Header('Cache-Control', NO_STORE)
  @Post()
  async create(
    @Param('accountId', uuidPipe) accountId: string,
    @Body(new ZodValidationPipe(createCredentialRequestSchema)) body: CreateCredentialRequest,
  ): Promise<Credential> {
    return toCredential(unwrap(await this.manageCredentials.create(accountId, body)));
  }
}

@Controller('credentials')
export class CredentialsController {
  constructor(private readonly manageCredentials: ManageCredentials) {}

  @Get(':id/history')
  async history(@Param('id', uuidPipe) id: string): Promise<{ data: PasswordVersion[] }> {
    const versions = unwrap(await this.manageCredentials.history(id));
    return { data: versions.map(toPasswordVersion) };
  }

  @Header('Cache-Control', NO_STORE)
  @Post(':id/password')
  async changePassword(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(changeCredentialPasswordRequestSchema))
    body: ChangeCredentialPasswordRequest,
  ): Promise<Credential> {
    return toCredential(unwrap(await this.manageCredentials.changePassword(id, body.password)));
  }

  // Sin cuerpo: la versión viaja en la ruta y la respuesta son los metadatos de la credencial, nunca el
  // contenido. Se responde 201 como al cambiar la contraseña, porque también crea una versión.
  @Header('Cache-Control', NO_STORE)
  @Post(':id/versions/:version/restore')
  async restoreVersion(
    @Param('id', uuidPipe) id: string,
    @Param('version', versionPipe) version: number,
  ): Promise<Credential> {
    return toCredential(unwrap(await this.manageCredentials.restoreVersion(id, version)));
  }

  @Header('Cache-Control', NO_STORE)
  @HttpCode(200)
  @Post(':id/username')
  async copyUsername(@Param('id', uuidPipe) id: string): Promise<CredentialUsername> {
    return { username: unwrap(await this.manageCredentials.copyUsername(id)) };
  }

  // Sin cuerpo obligatorio: uno ausente se trata como "sin motivo" y se niega con auditoría.
  @Header('Cache-Control', NO_STORE)
  @HttpCode(200)
  @Post(':id/reveal')
  async reveal(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(z.preprocess((body) => body ?? {}, revealPasswordRequestSchema)))
    body: RevealPasswordRequest,
  ): Promise<RevealedPassword> {
    return { password: unwrap(await this.manageCredentials.revealPassword(id, body.reason)) };
  }
}
