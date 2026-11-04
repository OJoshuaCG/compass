import { useId, type ComponentProps, type ReactNode } from 'react';

import { cn } from '../lib/cn';

/**
 * Clases del enlace de navegación. El estado activo se lee de `aria-current="page"`, de modo que
 * la misma cadena sirve para el `NavItem` y para el `Link` del enrutador (que fija ese atributo
 * por sí solo): el aspecto sigue al atributo accesible, nunca a una clase aparte.
 */
export const navItemClass = cn(
  'group flex min-h-10 items-center gap-3 rounded-md px-3 text-sm font-medium text-text-secondary',
  'transition-colors duration-fast hover:bg-raised hover:text-text',
  'aria-[current=page]:bg-surface aria-[current=page]:text-text aria-[current=page]:ring-1 aria-[current=page]:ring-inset aria-[current=page]:ring-border-strong',
);

/**
 * Clases del contenedor del ícono: apagado, y con el acento cuando el enlace es la página actual.
 * El tamaño lo fija el ícono (por ejemplo `className="size-5"`).
 */
export const navItemIconClass =
  'inline-flex shrink-0 opacity-85 group-aria-[current=page]:text-accent group-aria-[current=page]:opacity-100';

export type NavItemProps = Omit<ComponentProps<'a'>, 'children'> & {
  /** Ya traducido. */
  children: ReactNode;
  /** Ícono decorativo (por ejemplo uno de `@iam/ui/icons`); el texto da el nombre accesible. */
  icon: ReactNode;
  /** Marca la página actual con `aria-current="page"`. */
  active?: boolean;
};

/** Enlace de la navegación lateral: ícono + texto; la página activa lleva `aria-current`. */
export function NavItem({ icon, active = false, className, children, ...rest }: NavItemProps) {
  return (
    <a aria-current={active ? 'page' : undefined} className={cn(navItemClass, className)} {...rest}>
      <span aria-hidden="true" className={navItemIconClass}>
        {icon}
      </span>
      {children}
    </a>
  );
}

export type NavGroupProps = {
  /** Etiqueta del grupo, ya traducida. */
  label: string;
  /** Elementos `<li>` con enlaces (`NavItem` o el `Link` del enrutador). */
  children: ReactNode;
  className?: string;
};

/** Grupo de navegación con etiqueta pequeña; la lista se nombra con esa misma etiqueta. */
export function NavGroup({ label, children, className }: NavGroupProps) {
  const labelId = useId();
  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      <p
        id={labelId}
        // text-xs (12 px) en lugar de los 10.5 px del diseño: queda en la escala del proyecto y
        // el texto pequeño en gris sigue cumpliendo contraste (text-muted, §4.2).
        className="px-3 pb-1.5 font-mono text-xs tracking-widest text-text-muted uppercase"
      >
        {label}
      </p>
      <ul aria-labelledby={labelId} className="flex flex-col gap-0.5">
        {children}
      </ul>
    </div>
  );
}
