import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Ghostty, InputHandler } from 'ghostty-web';

type Bundle = { InputHandler: typeof InputHandler };

const bundles = ['ghostty-web.js', 'ghostty-web.umd.cjs'];
let directory: string;

beforeAll(() => {
  directory = mkdtempSync(join(process.cwd(), '.ghostty-input-test-'));
  const destination = join(directory, 'node_modules/ghostty-web/dist');
  mkdirSync(destination, { recursive: true });
  for (const bundle of bundles) {
    copyFileSync(resolve('node_modules/ghostty-web/dist', bundle), join(destination, bundle));
  }
  const args = ['apply', '--unsafe-paths', `--directory=${directory}`];
  const patch = resolve('patches/ghostty-web+0.4.0.patch');
  try {
    execFileSync('git', [...args, '--check', patch], { stdio: 'pipe' });
    execFileSync('git', [...args, patch], { stdio: 'pipe' });
  } catch {
    execFileSync('git', [...args, '--reverse', '--check', patch], { stdio: 'pipe' });
  }
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe.each(bundles)('ghostty input patch (%s)', (bundle) => {
  let handler: InputHandler;
  let container: HTMLDivElement;
  let onData: ReturnType<typeof vi.fn<(data: string) => void>>;
  let encode: ReturnType<typeof vi.fn>;

  const beforeInput = (data: string | null, inputType = 'insertText', isComposing = false) => {
    const event = new InputEvent('beforeinput', { data, inputType, isComposing, bubbles: true, cancelable: true });
    container.dispatchEvent(event);
    return event;
  };

  const keydown = (key: string, code: string, options: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, ...options });
    container.dispatchEvent(event);
    return event;
  };

  const composition = (type: string, data = '') => {
    container.dispatchEvent(new CompositionEvent(type, { data, bubbles: true }));
  };

  beforeEach(() => {
    const source = readFileSync(join(directory, 'node_modules/ghostty-web/dist', bundle), 'utf8');
    const code = source.replace(/export \{([\s\S]*?)\};?\s*$/, (_statement, exports: string) => {
      const properties = exports.replace(/([\w$]+) as ([\w$]+)/g, '$2: $1');
      return `module.exports = {${properties}};`;
    });
    const exports = {};
    const module = { exports };
    runInNewContext(code, { module, exports, console, TextDecoder, queueMicrotask });
    const library = module.exports as Bundle;
    onData = vi.fn();
    encode = vi.fn(() => new Uint8Array([3]));
    const ghostty = { createKeyEncoder: () => ({ encode, setOption: vi.fn() }) } as unknown as Ghostty;
    container = document.createElement('div');
    container.contentEditable = 'true';
    document.body.appendChild(container);
    container.addEventListener('beforeinput', (event) => event.preventDefault());
    handler = new library.InputHandler(ghostty, container, onData, vi.fn());
  });

  afterEach(() => {
    handler.dispose();
    container.remove();
  });

  it('forwards beforeinput-only letters, spaces, punctuation and Unicode without editing the DOM', () => {
    for (const char of 'abc áľ!?') {
      expect(beforeInput(char).defaultPrevented).toBe(true);
    }
    expect(onData.mock.calls.flat().join('')).toBe('abc áľ!?');
    expect(container.textContent).toBe('');
  });

  it('preserves rapid repeated letters', () => {
    beforeInput('a');
    beforeInput('a');
    beforeInput('a');
    expect(onData.mock.calls.flat().join('')).toBe('aaa');
  });

  it('cancels normal keyboard defaults and suppresses an immediate matching text echo', () => {
    expect(keydown('a', 'KeyA').defaultPrevented).toBe(true);
    beforeInput('a');
    beforeInput('a');
    expect(onData.mock.calls.flat().join('')).toBe('aa');
  });

  it('does not discard a later independent identical text input', async () => {
    keydown('a', 'KeyA');
    await Promise.resolve();
    beforeInput('a');
    expect(onData.mock.calls.flat().join('')).toBe('aa');
  });

  it.each(['insertText', 'insertFromComposition'])('emits a composition commit once before a following %s', (inputType) => {
    composition('compositionstart');
    beforeInput('a', 'insertCompositionText', true);
    composition('compositionupdate', 'á');
    expect(onData).not.toHaveBeenCalled();
    composition('compositionend', 'á');
    beforeInput('á', inputType);
    expect(onData).toHaveBeenCalledExactlyOnceWith('á');
  });

  it('emits a commit once when committed beforeinput precedes compositionend', () => {
    composition('compositionstart');
    beforeInput('á', 'insertFromComposition');
    expect(onData).not.toHaveBeenCalled();
    composition('compositionend', 'á');
    expect(onData).toHaveBeenCalledExactlyOnceWith('á');
  });

  it('preserves repeated compositions and cancelled compositions', () => {
    for (let index = 0; index < 2; index++) {
      composition('compositionstart');
      composition('compositionend', 'á');
      beforeInput('á');
    }
    composition('compositionstart');
    composition('compositionend');
    expect(onData.mock.calls.flat().join('')).toBe('áá');
  });

  it('handles replacement text and normalizes line endings', () => {
    beforeInput('hello\nworld', 'insertReplacementText');
    expect(onData).toHaveBeenCalledExactlyOnceWith('hello\rworld');
  });

  it('leaves control keys on the existing keyboard path', () => {
    keydown('Enter', 'Enter');
    keydown('Backspace', 'Backspace');
    keydown('c', 'KeyC', { ctrlKey: true });
    expect(onData.mock.calls.flat().join('')).toBe('\r\x7f\x03');
    expect(encode).toHaveBeenCalledOnce();
  });

  it('leaves arrow encoding unchanged', () => {
    encode.mockReturnValue(new TextEncoder().encode('\x1b[A'));
    keydown('ArrowUp', 'ArrowUp');
    expect(onData).toHaveBeenCalledExactlyOnceWith('\x1b[A');
  });

  it('does not duplicate paste or interpret editing commands as text', () => {
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => 'pasted' } });
    container.dispatchEvent(paste);
    beforeInput('pasted', 'insertFromPaste');
    beforeInput(null, 'deleteContentBackward');
    beforeInput(null, 'insertLineBreak');
    expect(onData).toHaveBeenCalledExactlyOnceWith('pasted');
  });

  it('removes text, keyboard and composition listeners on disposal', () => {
    handler.dispose();
    beforeInput('a');
    keydown('b', 'KeyB');
    composition('compositionend', 'á');
    expect(onData).not.toHaveBeenCalled();
  });
});
