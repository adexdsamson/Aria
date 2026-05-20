/**
 * Editorial primitives — behavior tests per 09-01 plan task 2.
 *
 * 8 tests covering MonogramSquare, StatusDot, RouteBadge, Button, Card,
 * Modal, AppLogo, and the barrel exports.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import * as editorial from '../index';
import {
  MonogramSquare,
  StatusDot,
  RouteBadge,
  Button,
  Card,
  Modal,
  AppLogo,
} from '../index';

afterEach(() => {
  cleanup();
});

describe('MonogramSquare', () => {
  it('renders the serif "A" letter with a gold underline rule', () => {
    const { container } = render(<MonogramSquare size={28} />);
    expect(container.textContent).toContain('A');
    const goldRule = container.querySelector('span > span');
    expect(goldRule).not.toBeNull();
    expect(goldRule).toHaveProperty('style');
    expect((goldRule as HTMLElement).style.background).toContain('--gold');
  });
});

describe('StatusDot', () => {
  it('applies the rose color when kind="err"', () => {
    const { container } = render(<StatusDot kind="err" />);
    const dot = container.querySelector('span');
    expect(dot).not.toBeNull();
    expect(dot!.getAttribute('data-status-kind')).toBe('err');
    expect((dot as HTMLElement).style.background).toContain('--rose');
  });
});

describe('RouteBadge', () => {
  it('renders "LOCAL" text with a gold-tinted background', () => {
    const { container } = render(<RouteBadge route="LOCAL" />);
    expect(container.textContent).toBe('LOCAL');
    const span = container.querySelector('span');
    expect((span as HTMLElement).style.background).toContain('184');
  });
});

describe('Button', () => {
  it('applies both .btn and .btn-primary classes and fires onClick', () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" onClick={onClick}>
        Approve
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Approve' });
    expect(btn.className).toContain('btn');
    expect(btn.className).toContain('btn-primary');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('Card', () => {
  it('applies .card-accent-top when accent="top"', () => {
    const { container } = render(
      <Card accent="top">
        <span>body</span>
      </Card>,
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('card');
    expect(card.className).toContain('card-accent-top');
  });
});

describe('Modal', () => {
  it('renders nothing when open=false; renders title and closes on Escape when open', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Modal open={false} onClose={onClose} title="Are you sure?">
        body
      </Modal>,
    );
    expect(screen.queryByText('Are you sure?')).toBeNull();

    rerender(
      <Modal open={true} onClose={onClose} title="Are you sure?">
        body
      </Modal>,
    );
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('AppLogo', () => {
  it('variant="sidebar" renders monogram "A" + wordmark "Aria"', () => {
    const { container } = render(<AppLogo variant="sidebar" />);
    expect(container.textContent).toContain('A');
    expect(container.textContent).toContain('Aria');
    expect(container.textContent).toContain('chief of staff');
  });

  it('variant="header" renders the editorial lockup with Est. 2026', () => {
    const { container } = render(<AppLogo variant="header" />);
    expect(container.textContent).toContain('Aria');
    expect(container.textContent).toContain('Est. 2026');
    expect(container.textContent).toContain('A Chief of Staff');
  });
});

describe('barrel exports (index.ts)', () => {
  it('re-exports all 11 editorial components as function/component references', () => {
    const expected = [
      'MonogramSquare',
      'Avatar',
      'StatusDot',
      'RouteBadge',
      'KbdHint',
      'LabelRule',
      'Card',
      'Button',
      'Input',
      'Modal',
      'AppLogo',
    ] as const;
    for (const name of expected) {
      const ref = (editorial as Record<string, unknown>)[name];
      expect(ref, `expected editorial.${name} to be exported`).toBeDefined();
      // forwardRef returns an object — accept function OR object with $$typeof.
      const isFn = typeof ref === 'function';
      const isForwardRef =
        typeof ref === 'object' && ref !== null && '$$typeof' in (ref as object);
      expect(isFn || isForwardRef, `editorial.${name} must be a component`).toBe(true);
    }
  });
});
