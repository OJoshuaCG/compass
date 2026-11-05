import { cn } from '../lib/cn';

export type StrengthLevel = 0 | 1 | 2 | 3 | 4;

export type StrengthMeterProps = {
  level: StrengthLevel;
  /** Nombre del medidor (ya traducido), p. ej. "Fortaleza de la contraseña". */
  label: string;
  /** Texto del nivel actual (ya traducido), p. ej. "Aceptable". */
  levelText: string;
  className?: string;
};

const BARS = [1, 2, 3, 4] as const;

function barTone(level: StrengthLevel): string {
  if (level <= 1) return 'bg-danger';
  if (level === 2) return 'bg-warning';
  return 'bg-success';
}

/**
 * Medidor de fortaleza: `role="meter"` con valor y texto para lectores de pantalla; el nivel
 * también se escribe, no solo se colorea. Es presentacional: calcular el nivel es asunto del
 * llamador (y nunca debe enviar el valor a terceros).
 */
export function StrengthMeter({ level, label, levelText, className }: StrengthMeterProps) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={level}
        aria-valuetext={levelText}
        className="flex gap-1"
      >
        {BARS.map((bar) => (
          <span
            key={bar}
            aria-hidden="true"
            className={cn(
              'h-1.5 flex-1 rounded-sm',
              bar <= level ? barTone(level) : 'bg-border-strong',
            )}
          />
        ))}
      </div>
      <p aria-hidden="true" className="text-xs text-text-secondary">
        {levelText}
      </p>
    </div>
  );
}
