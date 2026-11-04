import { buttonVariants } from '../atoms/button';
import { cn } from '../lib/cn';

/** Clases del botón de la barra, compartidas con el marcador de la carga diferida. */
export const USER_MENU_TRIGGER_CLASS = cn(
  buttonVariants({ variant: 'ghost', size: 'md' }),
  'gap-2 px-2',
);

/**
 * El nombre siempre está en el DOM (nombre accesible estable, WCAG 2.5.3) pero solo se ve desde
 * `sm`: en pantallas estrechas la barra muestra únicamente el avatar.
 */
export const USER_MENU_NAME_CLASS = 'sr-only sm:not-sr-only';
