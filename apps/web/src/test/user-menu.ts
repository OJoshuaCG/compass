import { screen, waitFor } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/**
 * Abre el menú de la persona. El menú se descarga de forma diferida y mientras tanto se pinta un
 * botón de respaldo con el mismo nombre pero deshabilitado y sin `aria-haspopup`: hay que esperar
 * al botón real, igual que lo hace quien usa la pantalla, antes de pulsarlo.
 */
export async function openUserMenu(user: UserEvent, personName: string): Promise<void> {
  const trigger: HTMLElement = await waitFor(() => {
    const candidate: HTMLElement = screen.getByRole('button', { name: personName });
    if (candidate.getAttribute('aria-haspopup') !== 'menu') {
      throw new Error('El menú de la persona todavía se está descargando.');
    }
    return candidate;
  });
  await user.click(trigger);
}
