import { describe, expect, it } from 'vitest';
import type { ModelListItem } from '@cursor/sdk';

import { createModelAliases, createModelSelections, resolveModelSelection } from '../model-selection';

describe('Cursor SDK model selections', () => {
  it.each(['grok-4.7-fast', 'composer-2-fast', 'another-fast', 'grok-4.7-fast-2'])('passes unknown model ID %s through without inferring parameters', (id) => {
    expect(resolveModelSelection(id, new Map())).toEqual({ id });
  });

  it('prioritizes real catalog IDs over generated fast aliases regardless of catalog order', () => {
    const baseModel: ModelListItem = {
      id: 'example',
      displayName: 'Example',
      variants: [{ params: [{ id: 'fast', value: 'true' }] }],
    };
    const fastModel: ModelListItem = {
      id: 'example-fast',
      displayName: 'Example Fast',
    };

    for (const models of [
      [baseModel, fastModel],
      [fastModel, baseModel],
    ]) {
      expect(resolveModelSelection('example-fast', createModelSelections(models))).toEqual({ id: 'example-fast' });
    }
  });

  it('preserves complete parameters for numbered fast variant aliases', () => {
    const fastModel: ModelListItem = {
      id: 'grok-4.7',
      displayName: 'Grok 4.7',
      variants: ['a', 'b'].map((value) => ({
        params: [
          { id: 'fast', value: 'true' },
          { id: 'mode', value },
        ],
      })),
    };
    const selections = createModelSelections([fastModel]);

    expect(resolveModelSelection('grok-4.7-fast-2', selections)).toEqual({
      id: 'grok-4.7',
      params: [
        { id: 'fast', value: 'true' },
        { id: 'mode', value: 'b' },
      ],
    });
  });
  const model: ModelListItem = {
    id: 'claude-fable-5',
    displayName: 'Claude Fable 5',
    parameters: [
      { id: 'context', values: [{ value: '200k' }, { value: '1m' }] },
      { id: 'effort', values: [{ value: 'low' }, { value: 'high' }] },
      { id: 'thinking', values: [{ value: 'false' }, { value: 'true' }] },
    ],
    variants: [
      {
        displayName: 'High reasoning',
        isDefault: true,
        params: [
          { id: 'context', value: '200k' },
          { id: 'effort', value: 'high' },
          { id: 'thinking', value: 'true' },
        ],
      },
      {
        displayName: 'High reasoning with 1M context',
        params: [
          { id: 'context', value: '1m' },
          { id: 'effort', value: 'high' },
          { id: 'thinking', value: 'true' },
        ],
      },
      {
        displayName: 'Thinking disabled',
        params: [
          { id: 'context', value: '1m' },
          { id: 'effort', value: 'high' },
          { id: 'thinking', value: 'false' },
        ],
      },
    ],
  };

  it('uses readable effort aliases and adds a context suffix only for 1M context', () => {
    expect(createModelAliases(model)).toEqual([
      {
        id: 'claude-fable-5-high',
        selection: {
          id: 'claude-fable-5',
          params: [
            { id: 'context', value: '200k' },
            { id: 'effort', value: 'high' },
            { id: 'thinking', value: 'true' },
          ],
        },
      },
      {
        id: 'claude-fable-5-high[1m]',
        selection: {
          id: 'claude-fable-5',
          params: [
            { id: 'context', value: '1m' },
            { id: 'effort', value: 'high' },
            { id: 'thinking', value: 'true' },
          ],
        },
      },
    ]);
  });

  it('does not list effort variants unless thinking is enabled', () => {
    const aliases = createModelAliases(model);

    expect(aliases.some((alias) => alias.selection.params?.some((param) => param.id === 'thinking' && param.value === 'false'))).toBe(false);
  });

  it('uses Cursor reasoning levels in aliases and filters disabled reasoning', () => {
    const aliases = createModelAliases({
      id: 'gpt-5.6-luna',
      displayName: 'GPT-5.6 Luna',
      variants: [
        {
          params: [
            { id: 'context', value: '272k' },
            { id: 'fast', value: 'false' },
            { id: 'reasoning', value: 'none' },
          ],
        },
        {
          params: [
            { id: 'context', value: '272k' },
            { id: 'fast', value: 'false' },
            { id: 'reasoning', value: 'high' },
          ],
        },
        {
          params: [
            { id: 'context', value: '1m' },
            { id: 'fast', value: 'true' },
            { id: 'reasoning', value: 'high' },
          ],
        },
      ],
    } as ModelListItem);

    expect(aliases.map((alias) => alias.id)).toEqual(['gpt-5.6-luna-high', 'gpt-5.6-luna-high-fast[1m]']);
  });

  it('resolves displayed aliases to their exact Cursor selections', () => {
    const selections = createModelSelections([
      model,
      {
        id: 'composer-2.5',
        displayName: 'Composer 2.5',
        variants: [{ params: [{ id: 'fast', value: 'true' }] }],
      },
    ]);

    expect(resolveModelSelection('claude-fable-5-high[1m]', selections)).toEqual({
      id: 'claude-fable-5',
      params: [
        { id: 'context', value: '1m' },
        { id: 'effort', value: 'high' },
        { id: 'thinking', value: 'true' },
      ],
    });
    expect(resolveModelSelection('composer-2.5#cursor-sdk-params=effort=high&thinking=true', selections)).toEqual({
      id: 'composer-2.5',
      params: [
        { id: 'effort', value: 'high' },
        { id: 'thinking', value: 'true' },
      ],
    });
    expect(resolveModelSelection('composer-2.5-fast', selections)).toEqual({
      id: 'composer-2.5',
      params: [{ id: 'fast', value: 'true' }],
    });
  });
});
