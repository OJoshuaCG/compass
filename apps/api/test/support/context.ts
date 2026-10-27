import { asOrganizationId, asUserId } from '../../src/shared/kernel/index.js';
import type { RequestContext } from '../../src/shared/kernel/index.js';

export const contextFor = (organizationId: string, requestId = 'req-test'): RequestContext => ({
  organizationId: asOrganizationId(organizationId),
  actorId: asUserId('0198cccc-0000-7000-8000-000000000003'),
  requestId,
  sessionId: null,
  reauthAt: null,
});
