/** Tipos de marca: un `UserId` no es intercambiable con un `CredentialId`. */
declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type OrganizationId = Brand<string, 'OrganizationId'>;
export type UserId = Brand<string, 'UserId'>;
export type CredentialId = Brand<string, 'CredentialId'>;

export const asOrganizationId = (value: string): OrganizationId => value as OrganizationId;
export const asUserId = (value: string): UserId => value as UserId;
export const asCredentialId = (value: string): CredentialId => value as CredentialId;
