import {
  createAccountRequestSchema,
  type Account,
  type CreateAccountRequest,
  type UpdateAccountRequest,
} from '@iam/contracts';
import { z } from 'zod';

/** Separador de las etiquetas en el campo de texto del formulario. */
const TAG_SEPARATOR = ',';

/** Convierte el texto "a, b, c" del formulario en la lista de etiquetas, sin vacíos ni repetidas. */
export function parseTags(text: string): string[] {
  const trimmedTags = text
    .split(TAG_SEPARATOR)
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
  return [...new Set(trimmedTags)];
}

export function tagsToText(tags: readonly string[]): string {
  return tags.join(`${TAG_SEPARATOR} `);
}

const handleContractSchema = createAccountRequestSchema.shape.handle;
const tagsContractSchema = createAccountRequestSchema.shape.tags;

/**
 * Esquema del formulario. Reutiliza las reglas del contrato para cada campo; el formulario trabaja
 * con texto (el campo vacío significa "sin valor" y las etiquetas van separadas por comas), así que
 * el cuerpo de la petición se arma después con `buildCreateBody` / `buildUpdateBody`.
 */
export const accountFormSchema = z.object({
  platformId: createAccountRequestSchema.shape.platformId,
  displayName: createAccountRequestSchema.shape.displayName,
  handle: z
    .string()
    .refine((text) => text.trim() === '' || handleContractSchema.safeParse(text).success),
  tags: z.string().refine((text) => tagsContractSchema.safeParse(parseTags(text)).success),
});
export type AccountFormValues = z.input<typeof accountFormSchema>;

/** Al editar no se cambia la plataforma: la cuenta queda ligada a la que se eligió al crearla. */
export const editAccountFormSchema = accountFormSchema.omit({ platformId: true });
export type EditAccountFormValues = z.input<typeof editAccountFormSchema>;

export function buildCreateBody(values: AccountFormValues): CreateAccountRequest {
  const handle = values.handle.trim();
  const tags = parseTags(values.tags);
  return {
    platformId: values.platformId,
    displayName: values.displayName.trim(),
    ...(handle === '' ? {} : { handle }),
    ...(tags.length === 0 ? {} : { tags }),
  };
}

/**
 * El PATCH reemplaza solo lo que viaja: se envían únicamente los campos que cambiaron y `null`
 * borra el identificador. Un objeto vacío significa "nada que guardar" (el servidor lo rechazaría).
 */
export function buildUpdateBody(
  account: Pick<Account, 'displayName' | 'handle' | 'tags'>,
  values: EditAccountFormValues,
): UpdateAccountRequest {
  const body: UpdateAccountRequest = {};

  const displayName = values.displayName.trim();
  if (displayName !== account.displayName) body.displayName = displayName;

  const trimmedHandle = values.handle.trim();
  const handle = trimmedHandle === '' ? null : trimmedHandle;
  if (handle !== account.handle) body.handle = handle;

  const tags = parseTags(values.tags);
  const tagsChanged = tags.join(TAG_SEPARATOR) !== account.tags.join(TAG_SEPARATOR);
  if (tagsChanged) body.tags = tags;

  return body;
}

export function isEmptyUpdate(body: UpdateAccountRequest): boolean {
  return Object.keys(body).length === 0;
}
