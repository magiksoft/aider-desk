// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement, useState } from 'react';
import { transform } from 'sucrase';
import { afterEach, describe, expect, it } from 'vitest';

import type { ButtonHTMLAttributes, ComponentType } from 'react';

const source = readFileSync(join(__dirname, '../ConfigComponent.jsx'), 'utf8');
const compiled = transform(`return (${source.trim().replace(/;$/, '')});`, { transforms: ['jsx'], production: true }).code;
const ConfigComponent = new Function('React', compiled)({ createElement }) as ComponentType<Record<string, unknown>>;

const backup = { providerId: 'backup', id: 'group/model' };
const disabled = { providerId: 'disabled', id: 'unavailable' };
const providers = [
  { id: 'backup', disabled: false },
  { id: 'disabled', disabled: true },
];

const ui = {
  Button: ({ children, onClick }: ButtonHTMLAttributes<HTMLButtonElement>) => createElement('button', { onClick }, children),
  Checkbox: ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) =>
    createElement(
      'label',
      {},
      createElement('input', {
        type: 'checkbox',
        'aria-label': label,
        checked,
        onChange: (event: Event) => onChange((event.target as HTMLInputElement).checked),
      }),
      label,
    ),
  Input: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (event: { target: { value: string } }) => void;
  }) =>
    createElement('input', {
      'aria-label': label,
      value,
      onChange: (event: Event) => onChange({ target: { value: (event.target as HTMLInputElement).value } }),
    }),
  TextArea: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (event: { target: { value: string } }) => void;
  }) =>
    createElement('textarea', {
      'aria-label': label,
      value,
      onChange: (event: Event) => onChange({ target: { value: (event.target as HTMLTextAreaElement).value } }),
    }),
  ModelSelector: ({
    models,
    onChange,
    selectedModelId,
    labelOnNull,
    usePortal,
  }: {
    models: (typeof backup)[];
    onChange: (model: typeof backup) => void;
    selectedModelId: string | null;
    labelOnNull: string;
    usePortal?: boolean;
  }) =>
    createElement(
      'div',
      { 'data-use-portal': String(Boolean(usePortal)) },
      selectedModelId ?? labelOnNull,
      ...models.map((model) => createElement('button', { key: model.id, onClick: () => onChange(model) }, model.id)),
    ),
};

afterEach(cleanup);

describe('Model Fallback ConfigComponent', () => {
  it('toggles enabled state, selects/clears a fallback model, filters disabled providers, and enables portal rendering', () => {
    const Wrapper = () => {
      const [config, updateConfig] = useState<{ enabled: boolean; fallbackModelId: string }>({
        enabled: true,
        fallbackModelId: '',
      });
      return createElement(ConfigComponent, {
        config,
        updateConfig,
        models: [backup, disabled],
        providers,
        ui,
      });
    };

    const { container } = render(createElement(Wrapper));

    expect(screen.getByText('Select a model')).toBeTruthy();
    expect(screen.queryByText('unavailable')).toBeNull();
    expect(container.querySelector('[data-use-portal="true"]')).not.toBeNull();

    fireEvent.click(screen.getByText('group/model'));
    expect(screen.getByText('backup/group/model')).toBeTruthy();

    fireEvent.click(screen.getByText('Clear'));
    expect(screen.getByText('Select a model')).toBeTruthy();

    const checkbox = screen.getByLabelText('Enable model fallback') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
  });

  it('trims and filters custom error codes and patterns on edit', () => {
    type Config = { enabled: boolean; fallbackModelId: string; customErrorCodes: string[]; customErrorPatterns: string[] };
    const Wrapper = () => {
      const [config, updateConfig] = useState<Config>({
        enabled: true,
        fallbackModelId: '',
        customErrorCodes: [],
        customErrorPatterns: [],
      });
      return createElement(ConfigComponent, { config, updateConfig, models: [], providers: [], ui });
    };

    render(createElement(Wrapper));

    fireEvent.change(screen.getByLabelText('Custom error codes'), {
      target: { value: ' ENTITLEMENT_ERROR, plan_required, ' },
    });
    fireEvent.change(screen.getByLabelText('Custom error patterns'), {
      target: { value: 'not subscribed\n\nsubscription expired\n' },
    });

    expect((screen.getByLabelText('Custom error codes') as HTMLInputElement).value).toBe('ENTITLEMENT_ERROR, plan_required');
    expect((screen.getByLabelText('Custom error patterns') as HTMLTextAreaElement).value).toBe('not subscribed\nsubscription expired');
  });
});
