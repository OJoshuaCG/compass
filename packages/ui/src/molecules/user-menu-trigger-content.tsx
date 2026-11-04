import { Avatar } from '../atoms/avatar';
import { ChevronDown } from '../icons';

import { USER_MENU_NAME_CLASS } from './user-menu-styles';

/**
 * Contenido del botón de la barra (avatar, nombre y flecha). Se comparte entre el marcador de la
 * carga diferida y el disparador real de Radix; no importa Radix para no romper la división del paquete.
 */
export function UserMenuTriggerContent({ name }: { readonly name: string }) {
  return (
    <>
      <Avatar name={name} size="sm" />
      <span className={USER_MENU_NAME_CLASS}>{name}</span>
      <ChevronDown aria-hidden="true" className="size-4" />
    </>
  );
}
