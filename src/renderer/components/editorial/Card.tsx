import React from 'react';

export interface CardProps {
  accent?: 'top';
  hover?: boolean;
  className?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

/**
 * Wraps children in `.card`. Optional `accent="top"` adds the 2px gold
 * top border; `hover` adds the documented hover shadow + strong rule.
 */
export function Card({ accent, hover, className, children, style }: CardProps): JSX.Element {
  const classes = [
    'card',
    accent === 'top' ? 'card-accent-top' : null,
    hover ? 'card-hover' : null,
    className ?? null,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={classes} style={style}>
      {children}
    </div>
  );
}
