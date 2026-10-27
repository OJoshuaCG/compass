import { z } from 'zod';

/** Respuesta `204 No Content`: el cliente entrega `undefined` cuando el cuerpo está vacío. */
export const noContentSchema = z.undefined();
