import { describe, expect, it } from 'vitest';

import { MockLanguageModelV4 } from '../model.js';

import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import type { MockProviderOptions } from '../types.js';

const collectModelStream = async (model: MockLanguageModelV4, prompt: string, options: MockProviderOptions = {}) => {
  const result = await model.doStream({
    prompt: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
  });
  const parts: LanguageModelV4StreamPart[] = [];
  const reader = result.stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    parts.push(value);
  }
  void options;
  return parts;
};

describe('MockLanguageModelV4 raw stream', () => {
  it('emits stream-start, response-metadata, text parts and finish in order', async () => {
    const model = new MockLanguageModelV4('headings');
    const parts = await collectModelStream(model, 'anything');

    expect(parts[0]?.type).toBe('stream-start');
    expect(parts[1]?.type).toBe('response-metadata');
    expect(parts[2]?.type).toBe('text-start');
    expect(parts.at(-1)?.type).toBe('finish');
    expect(parts.filter((part) => part.type === 'text-delta').length).toBeGreaterThan(1);

    const textDeltas = parts.filter((part) => part.type === 'text-delta') as Array<{ delta: string; id: string }>;
    expect(textDeltas.every((part) => part.id === textDeltas[0]?.id)).toBe(true);

    const finish = parts.at(-1) as { finishReason: { unified: string }; usage: { outputTokens: { total: number } } };
    expect(finish.finishReason.unified).toBe('stop');
    expect(finish.usage.outputTokens.total).toBeGreaterThan(0);
  });

  it('emits a single stream-start for error scenarios', async () => {
    const model = new MockLanguageModelV4('error');
    const parts = await collectModelStream(model, 'explode');

    expect(parts.filter((part) => part.type === 'stream-start').length).toBe(1);
    expect(parts.at(-1)?.type).toBe('error');
    expect(parts.some((part) => part.type === 'finish')).toBe(false);
    expect(parts.some((part) => part.type === 'text-delta')).toBe(true);
  });

  it('throttles text deltas according to tokens per second', async () => {
    const model = new MockLanguageModelV4('headings', { tokensPerSecond: 200, chunkSize: 4 });
    const startedAt = Date.now();
    const parts = await collectModelStream(model, 'anything');
    const elapsed = Date.now() - startedAt;

    const deltaCount = parts.filter((part) => part.type === 'text-delta').length;
    expect(deltaCount).toBeGreaterThan(30);
    expect(elapsed).toBeGreaterThanOrEqual((deltaCount - 1) * (1000 / 200) * 0.8);
  });

  it('does not delay when tokens per second is zero', async () => {
    const model = new MockLanguageModelV4('headings', { tokensPerSecond: 0 });
    const startedAt = Date.now();
    await collectModelStream(model, 'anything');
    expect(Date.now() - startedAt).toBeLessThan(150);
  });

  it('truncates output to maxOutputTokens with length finish reason', async () => {
    const model = new MockLanguageModelV4('headings');
    const result = await model.doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
      maxOutputTokens: 10,
    });
    const parts: LanguageModelV4StreamPart[] = [];
    const reader = result.stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      parts.push(value);
    }

    const finish = parts.at(-1) as { finishReason: { unified: string } };
    expect(finish.finishReason.unified).toBe('length');
    expect(parts.filter((part) => part.type === 'text-delta').length).toBe(10);
  });

  it('stops emitting after abort signal fires', async () => {
    const model = new MockLanguageModelV4('long-text', { tokensPerSecond: 500 });
    const abortController = new AbortController();
    const result = await model.doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
      abortSignal: abortController.signal,
    });
    const reader = result.stream.getReader();
    const parts: LanguageModelV4StreamPart[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      parts.push(value);
      if (parts.filter((part) => part.type === 'text-delta').length >= 5) {
        abortController.abort();
      }
    }
    expect(parts.filter((part) => part.type === 'text-delta').length).toBeLessThan(30);
  });

  it('records call info for each invocation', async () => {
    const model = new MockLanguageModelV4('default');
    await collectModelStream(model, 'first call at 25 t/s');
    await collectModelStream(model, 'second call');

    expect(model.calls.length).toBe(2);
    expect(model.calls[0]?.scenarioId).toBe('default');
    expect(model.calls[0]?.tokensPerSecond).toBe(25);
    expect(model.calls[1]?.tokensPerSecond).toBe(0);
    expect(model.calls[0]?.prompt).toBe('first call at 25 t/s');
  });
});

describe('MockLanguageModelV4 scenario resolution', () => {
  it('prefers the response queue over the model id', async () => {
    const model = new MockLanguageModelV4('headings', { responses: ['tables'] });
    const parts = await collectModelStream(model, 'anything');
    const text = parts
      .filter((part) => part.type === 'text-delta')
      .map((part) => (part as { delta: string }).delta)
      .join('');
    expect(text).toContain('| Provider |');
  });

  it('uses the model id as scenario id when it matches', async () => {
    const model = new MockLanguageModelV4('math');
    const parts = await collectModelStream(model, 'unrelated prompt');
    const text = parts
      .filter((part) => part.type === 'text-delta')
      .map((part) => (part as { delta: string }).delta)
      .join('');
    expect(text).toContain('$x =');
  });

  it('falls back to json scenario for json response format', async () => {
    const model = new MockLanguageModelV4('unknown-model');
    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'unrelated prompt' }] }],
      responseFormat: { type: 'json' },
    });
    const textPart = result.content.find((part) => part.type === 'text') as { text: string };
    expect(() => JSON.parse(textPart.text)).not.toThrow();
  });

  it('supports custom scenarios by id and keyword, and overrides built-ins', async () => {
    const overrideModel = new MockLanguageModelV4('headings', {
      scenarios: { headings: { parts: [{ type: 'text', text: 'overridden' }] } },
    });
    const byModelId = await overrideModel.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    });
    expect(byModelId.content[0]).toEqual({ type: 'text', text: 'overridden' });

    const byKeywordModel = new MockLanguageModelV4('other', {
      scenarios: { custom: { keywords: ['magic'], parts: [{ type: 'text', text: 'magic answer' }] } },
    });
    const byKeyword = await byKeywordModel.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'do some magic for me' }] }],
    });
    expect(byKeyword.content[0]).toEqual({ type: 'text', text: 'magic answer' });
  });

  it('throws APICallError from doGenerate for error scenarios', async () => {
    const model = new MockLanguageModelV4('error');
    await expect(model.doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'explode' }] }] })).rejects.toMatchObject({
      name: 'AI_APICallError',
      statusCode: 500,
    });
  });

  it('returns file content in doGenerate', async () => {
    const model = new MockLanguageModelV4('image-part');
    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'picture' }] }],
    });
    const filePart = result.content.find((part) => part.type === 'file') as { mediaType: string; data: { type: string; data: string } };
    expect(filePart.mediaType).toBe('image/png');
    expect(filePart.data.type).toBe('data');
    expect(filePart.data.data).toBeTruthy();
  });
});
