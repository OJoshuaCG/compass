import { registerOidcClientRequestSchema } from '@iam/contracts';
import { describe, expect, it } from 'vitest';

import { EMPTY_REGISTER_CLIENT_FORM, toRegisterRequest } from './register-client-model';

describe('toRegisterRequest', () => {
  it('drops blank rows and empty optional fields', () => {
    const request = toRegisterRequest({
      ...EMPTY_REGISTER_CLIENT_FORM,
      name: 'Acme CRM',
      redirectUris: [' https://crm.example.com/cb ', '  '],
      postLogoutRedirectUris: [''],
    });
    expect(request).toEqual({
      name: 'Acme CRM',
      redirectUris: ['https://crm.example.com/cb'],
      isExternal: false,
      maxRank: null,
    });
  });

  it('sends the optional fields that were filled and the rank as a number', () => {
    const request = toRegisterRequest({
      name: 'Acme CRM',
      redirectUris: ['https://crm.example.com/cb'],
      postLogoutRedirectUris: ['https://crm.example.com/bye'],
      backchannelLogoutUri: 'https://crm.example.com/logout',
      allowPrivateNetworkBackchannel: true,
      refreshJustification: 'Sesiones largas de soporte',
      isExternal: true,
      maxRank: '2',
    });
    expect(request.maxRank).toBe(2);
    expect(request.allowPrivateNetworkBackchannel).toBe(true);
    expect(request.postLogoutRedirectUris).toEqual(['https://crm.example.com/bye']);
    expect(registerOidcClientRequestSchema.safeParse(request).success).toBe(true);
  });

  it('does not send the private-network flag when the back-channel address was cleared', () => {
    const request = toRegisterRequest({
      ...EMPTY_REGISTER_CLIENT_FORM,
      name: 'Acme',
      redirectUris: ['https://crm.example.com/cb'],
      backchannelLogoutUri: '  ',
      allowPrivateNetworkBackchannel: true,
    });
    expect(request.allowPrivateNetworkBackchannel).toBeUndefined();
  });

  it('produces a body the contract rejects when no redirect address was given', () => {
    const request = toRegisterRequest({ ...EMPTY_REGISTER_CLIENT_FORM, name: 'Acme' });
    expect(registerOidcClientRequestSchema.safeParse(request).success).toBe(false);
  });
});
