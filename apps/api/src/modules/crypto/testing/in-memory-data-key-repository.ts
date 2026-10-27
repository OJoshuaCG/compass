import type { DataKeyRecord, DataKeyRepository } from '../application/ports/data-key-repository.js';

export class InMemoryDataKeyRepository implements DataKeyRepository {
  private readonly records = new Map<string, DataKeyRecord[]>();

  findActive(organizationId: string): Promise<DataKeyRecord | null> {
    const found = (this.records.get(organizationId) ?? []).find((r) => r.status === 'active');
    return Promise.resolve(found ?? null);
  }

  findByVersion(organizationId: string, version: number): Promise<DataKeyRecord | null> {
    const found = (this.records.get(organizationId) ?? []).find((r) => r.version === version);
    return Promise.resolve(found ?? null);
  }

  insertAsActive(record: Omit<DataKeyRecord, 'status'>): Promise<'inserted' | 'conflict'> {
    const list = this.records.get(record.organizationId) ?? [];
    if (list.some((r) => r.version === record.version)) return Promise.resolve('conflict');
    const retired = list.map((r) => ({ ...r, status: 'retired' as const }));
    this.records.set(record.organizationId, [...retired, { ...record, status: 'active' }]);
    return Promise.resolve('inserted');
  }

  all(organizationId: string): readonly DataKeyRecord[] {
    return this.records.get(organizationId) ?? [];
  }
}
