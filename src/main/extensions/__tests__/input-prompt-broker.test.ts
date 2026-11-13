import { afterEach, describe, expect, it, vi } from 'vitest';

import { InputPromptBroker } from '../input-prompt-broker';

import type { InputPromptData } from '@common/types';

const setup = () => {
  const prompts: InputPromptData[] = [];
  const broker = new InputPromptBroker({ sendInputPrompt: (data) => prompts.push(data) });
  return { broker, prompts };
};

afterEach(() => vi.useRealTimers());

describe('extension input prompts', () => {
  it('returns secret responses without broadcasting their values', async () => {
    const { broker, prompts } = setup();
    const response = broker.request({ message: 'Authenticate', type: 'password', allowRememberSession: true });
    expect(broker.respond(prompts[0].id, 'private-password', true)).toBe(true);
    expect(await response).toEqual({ value: 'private-password', rememberSession: true });
    expect(JSON.stringify(prompts)).not.toContain('private-password');
    expect(prompts[1]).toMatchObject({ id: prompts[0].id, dismissed: true });
    expect(broker.respond(prompts[0].id, 'late-response')).toBe(false);
  });

  it('queues dialogs and dismisses cancelled prompts before showing the next', async () => {
    const { broker, prompts } = setup();
    const controller = new AbortController();
    const first = broker.request({ message: 'First' }, controller.signal);
    const second = broker.request({ message: 'Second' });
    expect(prompts).toHaveLength(1);
    controller.abort();
    expect(await first).toEqual({ value: null, rememberSession: false });
    expect(prompts[1].dismissed).toBe(true);
    expect(prompts[2].message).toBe('Second');
    broker.respond(prompts[2].id, null, true);
    expect(await second).toEqual({ value: null, rememberSession: false });
  });

  it('does not display already cancelled requests', async () => {
    const { broker, prompts } = setup();
    const controller = new AbortController();
    controller.abort();
    expect(await broker.request({ message: 'Cancelled' }, controller.signal)).toEqual({ value: null, rememberSession: false });
    expect(prompts).toEqual([]);
  });

  it('expires unanswered requests', async () => {
    vi.useFakeTimers();
    const { broker, prompts } = setup();
    const response = broker.request({ message: 'Timeout' });
    await vi.advanceTimersByTimeAsync(180_000);
    expect(await response).toEqual({ value: null, rememberSession: false });
    expect(prompts.at(-1)?.dismissed).toBe(true);
  });
});
