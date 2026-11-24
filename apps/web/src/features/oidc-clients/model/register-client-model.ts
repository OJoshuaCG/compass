import { OIDC_CLIENT_MAX_RANKS, type RegisterOidcClientRequest } from '@iam/contracts';

/** Tope de direcciones por lista: el mismo `max` del contrato (`registerOidcClientRequestSchema`). */
export const MAX_URIS_PER_LIST = 10;

/** Rangos que se ofrecen como tope de acceso, en el orden del contrato (0 Raíz … 3 Operador). */
export const CLIENT_RANK_CHOICES = OIDC_CLIENT_MAX_RANKS;

/** Valores del formulario: texto en los campos y listas de texto; `maxRank` es '' o '0'..'3' (valor de un select). */
export type RegisterClientFormValues = {
  name: string;
  redirectUris: string[];
  postLogoutRedirectUris: string[];
  backchannelLogoutUri: string;
  allowPrivateNetworkBackchannel: boolean;
  refreshJustification: string;
  isExternal: boolean;
  maxRank: string;
};

export const EMPTY_REGISTER_CLIENT_FORM: RegisterClientFormValues = {
  name: '',
  redirectUris: [''],
  postLogoutRedirectUris: [],
  backchannelLogoutUri: '',
  allowPrivateNetworkBackchannel: false,
  refreshJustification: '',
  isExternal: false,
  maxRank: '',
};

function nonBlank(values: readonly string[]): string[] {
  return values.map((value) => value.trim()).filter((value) => value !== '');
}

/**
 * Cuerpo de `POST /sso/clients` desde el formulario. Las filas en blanco de las listas y los
 * campos opcionales vacíos no se envían; la validación fina de las direcciones la hace el
 * servidor (dominio), aquí solo se aplica el esquema del contrato antes de enviar.
 */
export function toRegisterRequest(values: RegisterClientFormValues): RegisterOidcClientRequest {
  const backchannelLogoutUri = values.backchannelLogoutUri.trim();
  const refreshJustification = values.refreshJustification.trim();
  const postLogoutRedirectUris = nonBlank(values.postLogoutRedirectUris);
  return {
    name: values.name,
    redirectUris: nonBlank(values.redirectUris),
    ...(postLogoutRedirectUris.length > 0 ? { postLogoutRedirectUris } : {}),
    ...(backchannelLogoutUri === '' ? {} : { backchannelLogoutUri }),
    // La casilla solo se ve con una dirección de aviso; si se vació después de marcarla, no se envía.
    ...(values.allowPrivateNetworkBackchannel && backchannelLogoutUri !== ''
      ? { allowPrivateNetworkBackchannel: true }
      : {}),
    ...(refreshJustification === '' ? {} : { refreshJustification }),
    isExternal: values.isExternal,
    maxRank: values.maxRank === '' ? null : Number(values.maxRank),
  };
}
