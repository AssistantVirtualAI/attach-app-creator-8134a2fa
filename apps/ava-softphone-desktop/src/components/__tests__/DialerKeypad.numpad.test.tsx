/**
 * DialerKeypad numpad + visual-feedback regression.
 *
 * Verifies:
 *  - Rapid physical numpad presses (0-9, *, #, +) forward to onKey.
 *  - Backspace fires onBackspace; Enter fires onSubmit.
 *  - Each activation applies the `ava-key-flash` class to the matching button
 *    (with `+` flashing the `0` key per DEFAULT_DIAL_KEYS).
 *  - Presses are ignored while focus is inside a text input.
 *  - Presses are ignored when the keypad root is display:none (off-screen).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import DialerKeypad from '../DialerKeypad';

// JSDOM has no layout: offsetParent is null even for a visible keypad.
// Model the browser's display:none behavior instead of weakening the
// production visibility guard to satisfy these keyboard tests.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) {
    let element: HTMLElement | null = this;
    while (element) {
      if (getComputedStyle(element).display === 'none') return null;
      element = element.parentElement;
    }
    return document.body;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function press(key: string) {
  fireEvent.keyDown(window, { key });
}

describe('DialerKeypad — physical numpad', () => {
  it('forwards rapid digit/*/# presses to onKey in order', () => {
    const onKey = vi.fn();
    render(<DialerKeypad onKey={onKey} />);
    ['5', '1', '4', '2', '3', '*', '#', '0', '9'].forEach(press);
    expect(onKey).toHaveBeenCalledTimes(9);
    expect(onKey.mock.calls.map((c) => c[0])).toEqual(['5', '1', '4', '2', '3', '*', '#', '0', '9']);
  });

  it('maps + to onKey("+") and flashes the 0 key', () => {
    const onKey = vi.fn();
    const { container } = render(<DialerKeypad onKey={onKey} />);
    press('+');
    expect(onKey).toHaveBeenCalledWith('+');
    const zero = container.querySelector('[data-key="0"]') || Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim().startsWith('0'));
    expect(zero?.className).toContain('ava-key-flash');
  });

  it('flashes the pressed digit button (visual feedback)', () => {
    const onKey = vi.fn();
    const { container } = render(<DialerKeypad onKey={onKey} />);
    press('7');
    const seven = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim().startsWith('7'));
    expect(seven?.className).toContain('ava-key-flash');
  });

  it('fires onBackspace on Backspace and onSubmit on Enter', () => {
    const onKey = vi.fn();
    const onBackspace = vi.fn();
    const onSubmit = vi.fn();
    render(<DialerKeypad onKey={onKey} onBackspace={onBackspace} onSubmit={onSubmit} />);
    // Rapid backspace burst — should call onBackspace once per press.
    press('Backspace'); press('Backspace'); press('Backspace');
    expect(onBackspace).toHaveBeenCalledTimes(3);
    press('Enter');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onKey).not.toHaveBeenCalled();
  });

  it('ignores presses when focus is inside a text input', () => {
    const onKey = vi.fn();
    render(
      <div>
        <input aria-label="query" />
        <DialerKeypad onKey={onKey} />
      </div>,
    );
    const input = document.querySelector('input')!;
    input.focus();
    fireEvent.keyDown(input, { key: '5', bubbles: true });
    // The window-level listener sees target = input → must ignore.
    expect(onKey).not.toHaveBeenCalled();
  });

  it('ignores presses when the keypad root is not visible', () => {
    const onKey = vi.fn();
    const { container } = render(<DialerKeypad onKey={onKey} />);
    const root = container.querySelector('[role="grid"]') as HTMLElement;
    // Force offsetParent === null (hidden) using the simulated browser layout.
    root.style.display = 'none';
    press('9');
    expect(onKey).not.toHaveBeenCalled();
  });
});
