import React from 'react';

export type ButtonVariant = 'primary' | 'outline' | 'ghost';

export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant;
  className?: string;
  children: React.ReactNode;
}

/**
 * Editorial button — applies `.btn .btn-{variant}` classes.
 * Forwards `onClick`, `disabled`, `type`, and the rest of native button props.
 */
export function Button({
  variant = 'primary',
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps): JSX.Element {
  const classes = ['btn', `btn-${variant}`, className ?? null].filter(Boolean).join(' ');
  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}
