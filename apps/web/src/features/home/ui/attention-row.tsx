import { IconBubble, type IconBubbleProps } from '@iam/ui';
import type { ReactNode } from 'react';

export type AttentionRowProps = {
  tone: IconBubbleProps['tone'];
  icon: ReactNode;
  title: string;
  description: string;
  /** Enlace a la pantalla donde se resuelve (con nombre accesible propio). */
  action: ReactNode;
};

/** Un pendiente de "Requiere tu atención": ícono de estado, qué pasa y cómo resolverlo. */
export function AttentionRow({ tone, icon, title, description, action }: AttentionRowProps) {
  return (
    <li className="flex items-center gap-4 px-5 py-4">
      <IconBubble tone={tone} icon={icon} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm font-semibold text-text">{title}</p>
        <p className="text-sm text-text-secondary">{description}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </li>
  );
}
