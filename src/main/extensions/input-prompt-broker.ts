import { randomUUID } from 'node:crypto';

import type { ExtensionInputResponse } from '@common/extensions';
import type { InputPromptData } from '@common/types';
import type { EventManager } from '@/events';

type PendingPrompt = {
  data: InputPromptData;
  finish: (response: ExtensionInputResponse) => void;
};

export class InputPromptBroker {
  private pending = new Map<string, PendingPrompt>();

  constructor(private readonly events: Pick<EventManager, 'sendInputPrompt'>) {}

  request(prompt: Omit<InputPromptData, 'id'>, signal?: AbortSignal): Promise<ExtensionInputResponse> {
    if (signal?.aborted) {
      return Promise.resolve({ value: null, rememberSession: false });
    }
    return new Promise((resolve) => {
      const id = randomUUID();
      const cancel = () => this.respond(id, null);
      const timer = setTimeout(cancel, 180_000);
      const data = { ...prompt, id };
      this.pending.set(id, {
        data,
        finish: (response) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', cancel);
          resolve(response);
        },
      });
      signal?.addEventListener('abort', cancel, { once: true });
      if (this.pending.size === 1) {
        this.events.sendInputPrompt(data);
      }
    });
  }

  respond(id: string, value: string | null, rememberSession = false): boolean {
    const prompt = this.pending.get(id);
    if (!prompt) {
      return false;
    }
    const active = this.pending.keys().next().value === id;
    this.pending.delete(id);
    prompt.finish({
      value,
      rememberSession: value !== null && rememberSession,
    });
    if (active) {
      this.events.sendInputPrompt({ id, message: '', dismissed: true });
      const next = this.pending.values().next().value;
      if (next) {
        this.events.sendInputPrompt(next.data);
      }
    }
    return true;
  }
}

const brokers = new WeakMap<EventManager, InputPromptBroker>();

export const getInputPromptBroker = (events: EventManager): InputPromptBroker => {
  let broker = brokers.get(events);
  if (!broker) {
    broker = new InputPromptBroker(events);
    brokers.set(events, broker);
  }
  return broker;
};
