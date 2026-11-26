import type { CSSProperties } from 'react';
import { cn } from '../utils';

export function Avatar({
  name,
  src,
  size = 44,
  online = false,
  className,
  ring = true
}: {
  name: string;
  src?: string | null;
  size?: number;
  online?: boolean;
  className?: string;
  ring?: boolean;
}) {
  const style = { width: size, height: size } as CSSProperties;
  return (
    <span
      className={cn('avatar', ring && 'avatar-ring', className)}
      style={style}
      aria-label={name}
    >
      {src ? (
        <img src={src} alt={name} draggable={false} />
      ) : (
        <span className="avatar-fallback" style={{ fontSize: size * 0.36 }}>
          {name.slice(0, 1)}
        </span>
      )}
      {online && <i className="avatar-online" aria-hidden />}
    </span>
  );
}
