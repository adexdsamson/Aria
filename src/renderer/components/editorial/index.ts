/**
 * Editorial primitives — Phase 9 design-system foundation.
 *
 * Every Phase 9 plan imports from this barrel. None of the primitives import
 * from src/renderer/features/* — they are leaf-level building blocks safe to
 * use from any screen, dialog, or test in isolation.
 */
export { MonogramSquare } from './MonogramSquare';
export { Avatar } from './Avatar';
export { StatusDot } from './StatusDot';
export { RouteBadge } from './RouteBadge';
export { KbdHint } from './KbdHint';
export { LabelRule } from './LabelRule';
export { Card } from './Card';
export { Button } from './Button';
export { Input } from './Input';
export { Modal } from './Modal';
export { AppLogo } from './Logo';
export { Checkbox } from './Checkbox';

export type { MonogramSquareProps } from './MonogramSquare';
export type { AvatarProps } from './Avatar';
export type { StatusDotKind, StatusDotProps } from './StatusDot';
export type { Route, RouteBadgeProps } from './RouteBadge';
export type { KbdHintProps } from './KbdHint';
export type { LabelRuleProps } from './LabelRule';
export type { CardProps } from './Card';
export type { ButtonVariant, ButtonProps } from './Button';
export type { InputProps } from './Input';
export type { ModalSize, ModalProps } from './Modal';
export type { LogoVariant, AppLogoProps } from './Logo';
export type { CheckboxProps } from './Checkbox';
