import type { ShareLevel } from '@iam/contracts';

import type { UserId } from '../../../../shared/kernel/index.js';

export type InboundSourceStatus = 'active' | 'suspended' | 'archived';

export interface SourceRecord {
  readonly id: string;
  readonly channel: 'mail' | 'sms';
  readonly address: string;
  readonly displayName: string;
  readonly accountId: string | null;
  readonly status: InboundSourceStatus;
  readonly createdAt: Date;
}

export interface ViewRecord {
  readonly id: string;
  readonly sourceId: string;
  readonly name: string;
  readonly templateIds: readonly string[];
  readonly createdAt: Date;
}

export type ConfigurableResource = 'mail_source' | 'mail_view';

export interface NewSource {
  readonly id: string;
  readonly address: string;
  readonly displayName: string;
  readonly accountId: string | null;
  readonly createdBy: UserId;
}

export interface NewView {
  readonly id: string;
  readonly sourceId: string;
  readonly name: string;
  readonly createdBy: UserId;
}

export interface TemplateChange {
  readonly added: number;
  readonly removed: number;
}

/** Todo corre en la transacción en curso, con la organización fijada por RLS. */
export interface InboundConfigurationRepository {
  /** Fuente no archivada; bloquea la fila para serializar cambios concurrentes. */
  findSourceForUpdate(sourceId: string): Promise<SourceRecord | null>;
  /** Vista no archivada de una fuente no archivada; bloquea la vista y su fuente. */
  findViewForUpdate(viewId: string): Promise<ViewRecord | null>;
  /** Nivel efectivo de la persona sobre la fuente o la vista (directo o por grupo), o `null`. */
  resourceLevel(
    resourceType: ConfigurableResource,
    resourceId: string,
    userId: UserId,
  ): Promise<ShareLevel | null>;
  accountIsActive(accountId: string): Promise<boolean>;
  /** Bloquea en modo compartido la fila de la cuenta: serializa contra quien revoca accesos a ella. */
  lockAccountForShare(accountId: string): Promise<void>;
  accountLevel(accountId: string, userId: UserId): Promise<ShareLevel | null>;
  /** Cuántas de las plantillas indicadas existen y no están archivadas. */
  countLiveTemplates(templateIds: readonly string[]): Promise<number>;

  insertSource(source: NewSource): Promise<'inserted' | 'address_taken'>;
  updateSource(
    sourceId: string,
    edit: { readonly displayName: string; readonly accountId: string | null },
  ): Promise<SourceRecord>;
  /** Archiva la fuente y sus vistas y revoca las comparticiones de ambas. Devuelve las revocadas. */
  archiveSource(
    sourceId: string,
    at: Date,
    revokedBy: UserId,
  ): Promise<{ readonly revokedShares: number }>;

  insertView(view: NewView): Promise<'inserted' | 'name_taken'>;
  renameView(viewId: string, name: string): Promise<'renamed' | 'name_taken'>;
  /** Deja exactamente las plantillas indicadas y cuenta lo agregado y lo quitado. */
  replaceTemplates(viewId: string, templateIds: readonly string[]): Promise<TemplateChange>;
  findView(viewId: string): Promise<ViewRecord | null>;
  findSource(sourceId: string): Promise<SourceRecord | null>;
  /** Archiva la vista y revoca sus comparticiones. Devuelve las revocadas. */
  archiveView(
    viewId: string,
    at: Date,
    revokedBy: UserId,
  ): Promise<{ readonly revokedShares: number }>;

  /** Da MANAGE a quien creó el recurso. */
  insertManageShare(input: {
    readonly id: string;
    readonly resourceType: ConfigurableResource;
    readonly resourceId: string;
    readonly userId: UserId;
  }): Promise<void>;
}
