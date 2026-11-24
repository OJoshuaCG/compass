import { buttonVariants, cn } from '@iam/ui';
import { Link } from '@tanstack/react-router';

import { SsoCard } from './sso-card';

export type InvalidRequestProps = {
  title: string;
  description: string;
  goHomeLabel: string;
};

/** Estado de error de una solicitud SSO inválida o vencida: explica y lleva al inicio. */
export function InvalidRequest({ title, description, goHomeLabel }: InvalidRequestProps) {
  return (
    <SsoCard title={title} description={description} focusTitle>
      <div className="flex flex-wrap gap-3">
        <Link to="/" className={cn(buttonVariants({ variant: 'secondary' }), 'max-sm:w-full')}>
          {goHomeLabel}
        </Link>
      </div>
    </SsoCard>
  );
}
