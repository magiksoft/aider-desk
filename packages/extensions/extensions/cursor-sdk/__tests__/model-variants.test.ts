import { describe, expect, it } from 'vitest';
import type { ModelListItem, ModelParameterValue } from '@cursor/sdk';

import { createModelAliases, createModelSelections, resolveModelSelection } from '../model-selection';

const getParams = (context: string, effort: string, fast: boolean): ModelParameterValue[] => [
  { id: 'context', value: context },
  { id: 'reasoning_effort', value: effort },
  { id: 'fast', value: String(fast) },
];

const grok: ModelListItem = {
  id: 'grok-4.7',
  displayName: 'Grok 4.7',
  parameters: [
    { id: 'context', values: [{ value: '256k' }, { value: '500k' }] },
    { id: 'reasoning_effort', values: ['low', 'medium', 'high', 'xhigh'].map((value) => ({ value })) },
    { id: 'fast', values: [{ value: 'false' }, { value: 'true' }] },
  ],
  variants: ['256k', '500k'].flatMap((context) =>
    ['low', 'medium', 'high', 'xhigh'].flatMap((effort) =>
      [false, true].map((fast) => ({
        displayName: `Grok ${context} ${effort} ${fast}`,
        isDefault: context === '500k' && effort === 'high' && fast,
        params: getParams(context, effort, fast),
      })),
    ),
  ),
};

const sorted = (params: ModelParameterValue[]) => [...params].sort((left, right) => left.id.localeCompare(right.id));

describe('Cursor SDK catalog variants', () => {
  it('gives every Grok reasoning, context, and speed combination a distinct readable alias', () => {
    const aliases = createModelAliases(grok);
    const selections = createModelSelections([grok]);

    expect(aliases).toHaveLength(16);
    for (const context of ['256k', '500k']) {
      for (const effort of ['low', 'medium', 'high', 'xhigh']) {
        for (const fast of [false, true]) {
          const id = `grok-4.7-${effort}${fast ? '-fast' : ''}${context === '500k' ? '[500k]' : ''}`;
          expect(aliases.find((alias) => alias.id === id)?.selection).toEqual({
            id: grok.id,
            params: sorted(getParams(context, effort, fast)),
          });
          expect(resolveModelSelection(id, selections)).toEqual(aliases.find((alias) => alias.id === id)?.selection);
        }
      }
    }
  });

  it('resolves the plain fast alias to standard context with the default reasoning level', () => {
    expect(resolveModelSelection('grok-4.7-fast', createModelSelections([grok]))).toEqual({
      id: grok.id,
      params: sorted(getParams('256k', 'high', true)),
    });
  });

  it('does not change explicitly selected extended contexts or legacy numbered variants', () => {
    const selections = createModelSelections([grok]);
    expect(resolveModelSelection('grok-4.7-high-fast[500k]', selections)).toEqual({
      id: grok.id,
      params: sorted(getParams('500k', 'high', true)),
    });
    expect(resolveModelSelection('grok-4.7-fast-2', selections)).toEqual({
      id: grok.id,
      params: sorted(getParams('256k', 'low', true)),
    });
    expect(resolveModelSelection('grok-4.7', selections)).toEqual({ id: grok.id });
  });

  it.each(['effort', 'reasoning', 'reasoning_effort'])('names all reasoning variants using %s without renaming the parameter', (id) => {
    const model: ModelListItem = {
      id: 'reasoning-model',
      displayName: 'Reasoning model',
      variants: ['low', 'medium', 'high'].map((value) => ({ displayName: value, params: [{ id, value }] })),
    };
    expect(createModelAliases(model).map((alias) => alias.id)).toEqual(['reasoning-model-low', 'reasoning-model-medium', 'reasoning-model-high']);
    expect(resolveModelSelection('reasoning-model-high', createModelSelections([model]))).toEqual({
      id: model.id,
      params: [{ id, value: 'high' }],
    });
  });

  it('keeps Composer fast and non-fast selections separate even when fast is the default', () => {
    const model: ModelListItem = {
      id: 'composer-2.5',
      displayName: 'Composer 2.5',
      variants: [
        { displayName: 'Fast', isDefault: true, params: [{ id: 'fast', value: 'true' }] },
        { displayName: 'Normal', params: [{ id: 'fast', value: 'false' }] },
      ],
    };
    const selections = createModelSelections([model]);
    for (const fast of [false, true]) {
      expect(resolveModelSelection(`composer-2.5${fast ? '-fast' : ''}`, selections)).toEqual({
        id: model.id,
        params: [{ id: 'fast', value: String(fast) }],
      });
    }
  });

  it('labels additional varying parameters while retaining constant hidden parameters', () => {
    const model: ModelListItem = {
      id: 'deepseek',
      displayName: 'DeepSeek',
      variants: ['a', 'b'].map((mode) => ({
        displayName: mode,
        params: [
          { id: 'mode', value: mode },
          { id: 'cyber', value: 'false' },
        ],
      })),
    };
    const aliases = createModelAliases(model);
    expect(aliases.map((alias) => alias.id)).toEqual(['deepseek-mode=a', 'deepseek-mode=b']);
    expect(aliases[1].selection.params).toContainEqual({ id: 'cyber', value: 'false' });
    expect(resolveModelSelection('deepseek-2', createModelSelections([model]))).toEqual(aliases[1].selection);
  });

  it('does not synthesize unsupported parameter combinations when variants have no explicit default', () => {
    const model: ModelListItem = {
      id: 'constrained',
      displayName: 'Constrained',
      parameters: [
        { id: 'context', values: [{ value: '500k' }, { value: '256k' }] },
        { id: 'effort', values: [{ value: 'high' }, { value: 'low' }] },
      ],
      variants: [
        {
          displayName: 'Small high',
          params: [
            { id: 'context', value: '256k' },
            { id: 'effort', value: 'high' },
          ],
        },
        {
          displayName: 'Large low',
          params: [
            { id: 'context', value: '500k' },
            { id: 'effort', value: 'low' },
          ],
        },
      ],
    };
    expect(createModelAliases(model).map((alias) => alias.id)).toEqual(['constrained-high', 'constrained-low[500k]']);
  });

  it('supports models that advertise parameters without variants', () => {
    const aliases = createModelAliases({
      id: 'gemini',
      displayName: 'Gemini',
      parameters: [{ id: 'reasoning_effort', values: ['low', 'high'].map((value) => ({ value })) }],
    });
    expect(aliases.map((alias) => alias.id)).toEqual(['gemini-low', 'gemini-high']);
  });

  it('preserves generated variants when their readable alias conflicts with a real model ID', () => {
    const model: ModelListItem = {
      id: 'example',
      displayName: 'Example',
      variants: [{ displayName: 'Fast', params: [{ id: 'fast', value: 'true' }] }],
    };
    const other: ModelListItem = { id: 'example-fast', displayName: 'Actual model' };
    for (const models of [
      [model, other],
      [other, model],
    ]) {
      const aliases = createModelAliases(model, new Set(models.map((item) => item.id)));
      const selections = createModelSelections(models);
      expect(aliases[0].id).not.toBe('example-fast');
      expect(resolveModelSelection(aliases[0].id, selections)).toEqual(aliases[0].selection);
      expect(resolveModelSelection('example-fast', selections)).toEqual({ id: 'example-fast' });
    }
  });
});
