import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

export type ShortcutLinkProps = {
  to: '/users' | '/accounts' | '/security';
  icon: ReactNode;
  /** Ya traducidos. */
  title: string;
  description: string;
};

/** Acceso directo: un enlace de verdad (navega con teclado y se anuncia como enlace). */
export function ShortcutLink({ to, icon, title, description }: ShortcutLinkProps) {
  return (
    <Link
      to={to}
      className="flex min-h-12 items-start gap-3 rounded-lg border border-border-strong bg-surface p-5 transition-colors duration-fast hover:bg-raised"
    >
      <span aria-hidden="true" className="mt-0.5 text-text-secondary">
        {icon}
      </span>
      <span className="flex flex-col gap-1">
        <span className="font-medium text-text">{title}</span>
        <span className="text-sm text-text-secondary">{description}</span>
      </span>
    </Link>
  );
}
