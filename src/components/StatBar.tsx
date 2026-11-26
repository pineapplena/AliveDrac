import { cn } from '../utils';

export function StatBar({
  label,
  value,
  text,
  color = 'var(--amber)',
  compact = false
}: {
  label: string;
  value: number;
  text?: string;
  color?: string;
  compact?: boolean;
}) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className={cn('stat-bar', compact && 'stat-bar-compact')}>
      <div className="stat-bar-head">
        <span>{label}</span>
        <em>{text ?? `${percent}%`}</em>
      </div>
      <div className="stat-track">
        <span style={{ width: `${percent}%`, background: color }} />
      </div>
    </div>
  );
}
