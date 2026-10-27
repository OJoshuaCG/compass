import type { OrganizationId } from '../../../../shared/kernel/index.js';

export type DataKeyStatus = 'active' | 'retired';

export interface DataKeyRecord {
  readonly organizationId: OrganizationId;
  readonly version: number;
  readonly wrapped: Uint8Array;
  readonly kmsKeyRef: string;
  readonly status: DataKeyStatus;
}

export interface DataKeyRepository {
  findActive(organizationId: OrganizationId): Promise<DataKeyRecord | null>;
  findByVersion(organizationId: OrganizationId, version: number): Promise<DataKeyRecord | null>;
  /**
   * Inserta `record` como la versión activa y retira la anterior, de forma atómica.
   * Devuelve `conflict` si otra instancia ya creó esa versión (restricción única).
   */
  insertAsActive(record: Omit<DataKeyRecord, 'status'>): Promise<'inserted' | 'conflict'>;
}
