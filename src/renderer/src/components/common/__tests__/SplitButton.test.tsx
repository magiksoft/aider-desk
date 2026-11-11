import { createRef } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

import { SplitButton, SplitButtonAction } from '../SplitButton';
import { Button, ButtonColor, ButtonSize, ButtonVariant } from '../Button';

const createActions = (): SplitButtonAction[] => [
  { id: 'squash', label: 'Squash', onClick: vi.fn(), icon: <span>+</span> },
  { id: 'disabled', label: 'Unavailable', onClick: vi.fn(), disabled: true },
  { id: 'rebase', label: 'Rebase', onClick: vi.fn() },
];

const getTrigger = () => screen.getByRole('button', { name: 'splitButton.moreActions' });

describe('SplitButton', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('runs the primary action independently of the dropdown', () => {
    const onClick = vi.fn();
    const actions = createActions();
    render(
      <SplitButton actions={actions} onClick={onClick}>
        Merge
      </SplitButton>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.click(getTrigger());
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(getTrigger()).toHaveAttribute('aria-expanded', 'true');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('executes an additional action, closes the menu, and restores focus', async () => {
    const actions = createActions();
    const onClick = vi.fn();
    render(
      <SplitButton actions={actions} onClick={onClick}>
        Merge
      </SplitButton>,
    );
    fireEvent.click(getTrigger());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Squash' }));

    expect(actions[0].onClick).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    await waitFor(() => expect(getTrigger()).toHaveFocus());
  });

  it('does not execute disabled actions', () => {
    const actions = createActions();
    render(<SplitButton actions={actions}>Merge</SplitButton>);
    fireEvent.click(getTrigger());
    const item = screen.getByRole('menuitem', { name: 'Unavailable' });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(item);
    expect(actions[1].onClick).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('supports keyboard navigation, skipping disabled items, and Enter', async () => {
    const actions = createActions();
    render(<SplitButton actions={actions}>Merge</SplitButton>);
    act(() => getTrigger().focus());
    fireEvent.keyDown(getTrigger(), { key: 'ArrowDown' });
    const menu = screen.getByRole('menu');
    const first = screen.getByRole('menuitem', { name: 'Squash' });
    await waitFor(() => expect(menu).toHaveAttribute('aria-activedescendant', first.id));
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    const last = screen.getByRole('menuitem', { name: 'Rebase' });
    expect(menu).toHaveAttribute('aria-activedescendant', last.id);
    fireEvent.keyDown(menu, { key: 'Enter' });
    expect(actions[2].onClick).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('dismisses with Escape and returns focus to the arrow', async () => {
    render(<SplitButton actions={createActions()}>Merge</SplitButton>);
    fireEvent.click(getTrigger());
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    await waitFor(() => expect(getTrigger()).toHaveFocus());
  });

  it('dismisses when clicking outside', async () => {
    render(
      <>
        <SplitButton actions={createActions()}>Merge</SplitButton>
        <button>Outside</button>
      </>,
    );
    fireEvent.click(getTrigger());
    const outside = screen.getByRole('button', { name: 'Outside' });
    fireEvent.pointerDown(outside);
    fireEvent.pointerUp(outside);
    fireEvent.click(outside);
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('disables both buttons when disabled', () => {
    const onClick = vi.fn();
    render(
      <SplitButton actions={createActions()} disabled onClick={onClick}>
        Merge
      </SplitButton>,
    );
    expect(screen.getByRole('button', { name: 'Merge' })).toBeDisabled();
    expect(getTrigger()).toBeDisabled();
    fireEvent.click(getTrigger());
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('disables the arrow for an empty action list without disabling the primary action', () => {
    render(<SplitButton actions={[]}>Merge</SplitButton>);
    expect(getTrigger()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Merge' })).not.toBeDisabled();
  });

  it('accepts a custom menu label and keeps the arrow from submitting forms', () => {
    render(
      <SplitButton actions={createActions()} type="submit" menuLabel="Other merge methods">
        Merge
      </SplitButton>,
    );
    expect(screen.getByRole('button', { name: 'Merge' })).toHaveAttribute('type', 'submit');
    expect(screen.getByRole('button', { name: 'Other merge methods' })).toHaveAttribute('type', 'button');
  });

  it.each<ButtonVariant>(['contained', 'text', 'outline'])('matches Button styling for the %s variant', (variant) => {
    render(
      <>
        <Button variant={variant}>Reference</Button>
        <SplitButton actions={createActions()} variant={variant}>
          Merge
        </SplitButton>
      </>,
    );
    const expected = screen
      .getByRole('button', { name: 'Reference' })
      .className.split(' ')
      .filter((name) => !name.startsWith('rounded'));
    for (const button of [screen.getByRole('button', { name: 'Merge' }), getTrigger()]) {
      for (const className of expected.filter((name) => !name.startsWith('px-'))) {
        expect(button).toHaveClass(className);
      }
    }
  });

  it.each<ButtonColor>(['primary', 'secondary', 'tertiary', 'danger'])('supports the %s color on both halves', (color) => {
    render(
      <>
        <Button color={color}>Reference</Button>
        <SplitButton actions={createActions()} color={color}>
          Merge
        </SplitButton>
      </>,
    );
    const expected = screen
      .getByRole('button', { name: 'Reference' })
      .className.split(' ')
      .filter((name) => /^(bg-|text-|border-)/.test(name));
    for (const button of [screen.getByRole('button', { name: 'Merge' }), getTrigger()]) {
      for (const className of expected) {
        expect(button).toHaveClass(className);
      }
    }
  });

  it.each<ButtonSize>(['xs', 'sm', 'md'])('supports the %s size on both halves', (size) => {
    render(
      <>
        <Button size={size}>Reference</Button>
        <SplitButton actions={createActions()} size={size}>
          Merge
        </SplitButton>
      </>,
    );
    const expected = screen
      .getByRole('button', { name: 'Reference' })
      .className.split(' ')
      .filter((name) => /^(py-|text-)/.test(name));
    for (const button of [screen.getByRole('button', { name: 'Merge' }), getTrigger()]) {
      for (const className of expected) {
        expect(button).toHaveClass(className);
      }
    }
  });

  it('preserves native Button attributes and refs', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Button ref={ref} aria-label="Accessible action" data-testid="native-button">
        Action
      </Button>,
    );
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Accessible action' }));
    expect(ref.current).toHaveAttribute('data-testid', 'native-button');
  });
});
