import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../lib/cn';

import { PLATFORM_LOGO_PATHS } from './platform-logo-paths';

export const platformTileVariants = cva(
  'flex shrink-0 items-center justify-center bg-raised font-bold text-accent',
  {
    variants: {
      size: {
        sm: 'size-9 rounded-md text-xs',
        lg: 'size-14 rounded-lg text-lg',
      },
    },
    defaultVariants: { size: 'sm' },
  },
);

const logoSize = { sm: 'size-5', lg: 'size-7' } as const;

export type PlatformTileProps = VariantProps<typeof platformTileVariants> & {
  /**
   * `slug` de una plataforma del catálogo global. Las de la organización pasan `undefined`: su
   * slug lo elige la organización y no debe tomar el logotipo de una marca real.
   */
  slug?: string | undefined;
  /** Texto del que salen las dos letras cuando no hay logotipo (nombre de plataforma o cuenta). */
  fallback: string;
  className?: string;
};

/**
 * Mosaico de la plataforma de una cuenta, como el diseño de Compass: el logotipo en el color del
 * acento o, si no hay, las dos primeras letras. Es decorativo: el nombre siempre va al lado.
 */
export function PlatformTile({ slug, fallback, size, className }: PlatformTileProps) {
  const path = slug === undefined ? undefined : PLATFORM_LOGO_PATHS[slug];
  return (
    <span aria-hidden="true" className={cn(platformTileVariants({ size }), className)}>
      {path !== undefined ? (
        <svg viewBox="0 0 24 24" className={logoSize[size ?? 'sm']} fill="currentColor">
          <path d={path} />
        </svg>
      ) : (
        fallback.slice(0, 2).toUpperCase()
      )}
    </span>
  );
}
