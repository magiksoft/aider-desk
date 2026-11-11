import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AiderSettingsData, Model, ProjectData, SettingsData } from '@common/types';

import { AiderSettings } from '../AiderSettings';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/contexts/ModelProviderContext', () => ({
  useModelProviders: () => ({
    models: [{ id: 'available', providerId: 'provider' }],
    providers: [{ id: 'provider', name: 'Provider', provider: { name: 'anthropic' } }],
  }),
}));
vi.mock('@/components/ModelSelector', () => ({
  ModelSelector: ({
    selectedModelId,
    resolvedModelId,
    selectionHint,
    labelOnNull,
    selectedLabelOnNull,
    onChange,
  }: {
    selectedModelId: string | null;
    resolvedModelId?: string;
    selectionHint?: string;
    labelOnNull: string;
    selectedLabelOnNull?: string;
    onChange: (model: Model | null) => void;
  }) => (
    <div>
      {resolvedModelId ? (
        <span>
          {resolvedModelId} {selectionHint}
        </span>
      ) : (
        <span>{selectedLabelOnNull ?? labelOnNull}</span>
      )}
      <select
        aria-label={labelOnNull}
        value={selectedModelId ?? ''}
        onChange={(event) => onChange(event.target.value ? { id: 'available', providerId: 'provider' } : null)}
      >
        <option value="">{labelOnNull}</option>
        <option value="provider/available">Available</option>
      </select>
    </div>
  ),
}));
vi.mock('@/components/common/IconButton', () => ({
  IconButton: ({ tooltip, onClick, disabled }: { tooltip: string; onClick: () => void; disabled?: boolean }) => (
    <button aria-label={tooltip} onClick={onClick} disabled={disabled}>
      {tooltip}
    </button>
  ),
}));

const defaults: SettingsData = {
  preferredModels: [],
  aider: {
    options: '',
    environmentVariables: 'GLOBAL_FLAG=keep',
    autoCommits: true,
    cachingEnabled: false,
    watchFiles: false,
    confirmBeforeEdit: false,
    addRuleFiles: true,
  },
} as unknown as SettingsData;
const projects = [
  { baseDir: '/project', settings: {} },
  { baseDir: '/other', settings: {} },
] as ProjectData[];

const Harness = () => {
  const [settings, setSettings] = useState(defaults);
  const [overrides, setOverrides] = useState<Record<string, Partial<AiderSettingsData>>>({});
  const handleOverridesChange = (baseDir: string, value: Partial<AiderSettingsData>) => {
    setOverrides((current) => ({ ...current, [baseDir]: value }));
  };
  return (
    <AiderSettings
      settings={settings}
      setSettings={setSettings}
      openProjects={projects}
      projectOverrides={overrides}
      onProjectOverridesChange={handleOverridesChange}
    />
  );
};

const field = (name: string) => within(screen.getByRole('group', { name }));
const nextContext = () => fireEvent.click(screen.getByRole('button', { name: 'settings.common.nextContext' }));
const previousContext = () => fireEvent.click(screen.getByRole('button', { name: 'settings.common.previousContext' }));

describe('AiderSettings', () => {
  it('emphasizes the main model during onboarding and hides scope and advanced settings by default', () => {
    const setSettings = vi.fn();
    render(<AiderSettings settings={defaults} setSettings={setSettings} onboarding />);

    expect(field('modelSelector.mainModel').getByRole('combobox')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'settings.common.nextContext' })).not.toBeInTheDocument();
    const summary = screen.getByText('onboarding.aider.advancedSettings');
    const details = summary.closest('details');
    expect(details).not.toHaveAttribute('open');
    expect(field('modelSelector.weakModel').getByRole('combobox')).not.toBeVisible();

    fireEvent.change(field('modelSelector.mainModel').getByRole('combobox'), { target: { value: 'provider/available' } });
    expect(setSettings).toHaveBeenLastCalledWith({ ...defaults, aider: { ...defaults.aider, mainModel: 'provider/available' } });
    fireEvent.change(field('modelSelector.mainModel').getByRole('combobox'), { target: { value: '' } });
    expect(setSettings).toHaveBeenLastCalledWith({ ...defaults, aider: { ...defaults.aider, mainModel: null } });

    fireEvent.click(summary);
    expect(details).toHaveAttribute('open');
    expect(field('modelSelector.weakModel').getByRole('combobox')).toBeVisible();
    expect(field('modelSelector.architectModel').getByRole('combobox')).toBeVisible();
    expect(screen.getByRole('button', { name: 'settings.common.showSecrets' })).toBeVisible();
  });

  it('shows the resolved model with the automatic hint for the main model but only the inherited label for auxiliary models', () => {
    render(<Harness />);
    expect(field('modelSelector.mainModel').getByText('provider/available (settings.aider.auto)')).toBeInTheDocument();
    expect(field('modelSelector.weakModel').getByText('settings.aider.inherited')).toBeInTheDocument();
    expect(field('modelSelector.weakModel').queryByText(/provider\/available/)).not.toBeInTheDocument();
    expect(field('modelSelector.architectModel').getByText('settings.aider.inherited')).toBeInTheDocument();
    expect(field('modelSelector.architectModel').queryByText(/provider\/available/)).not.toBeInTheDocument();
  });

  it('uses the Override action and clear control, and keeps changes scoped to the selected project', () => {
    render(<Harness />);
    nextContext(); // global -> /project
    const mainGroup = screen.getByRole('group', { name: 'modelSelector.mainModel' });
    expect(within(mainGroup).getByRole('combobox')).toBeDisabled();
    fireEvent.click(within(mainGroup.parentElement!).getByText('settings.agent.override'));
    expect(field('modelSelector.mainModel').getByRole('combobox')).not.toBeDisabled();
    fireEvent.change(field('modelSelector.mainModel').getByRole('combobox'), { target: { value: 'provider/available' } });
    expect(field('modelSelector.mainModel').getByRole('combobox')).toHaveValue('provider/available');
    nextContext(); // /project -> /other
    expect(field('modelSelector.mainModel').getByRole('combobox')).toBeDisabled();
    previousContext(); // /other -> /project
    expect(field('modelSelector.mainModel').getByRole('combobox')).toHaveValue('provider/available');
    fireEvent.click(screen.getByRole('button', { name: 'settings.agent.clearOverride' }));
    expect(field('modelSelector.mainModel').getByRole('combobox')).toBeDisabled();
  });

  it('keeps an explicit inherit-from-Main override separate from inheriting the global auxiliary model', () => {
    render(<Harness />);
    fireEvent.change(field('modelSelector.weakModel').getByRole('combobox'), { target: { value: 'provider/available' } });
    nextContext(); // global -> /project
    const group = screen.getByRole('group', { name: 'modelSelector.weakModel' });
    fireEvent.click(within(group.parentElement!).getByText('settings.agent.override'));
    fireEvent.change(field('modelSelector.weakModel').getByRole('combobox'), { target: { value: '' } });
    expect(field('modelSelector.weakModel').getByRole('combobox')).toHaveValue('');
    previousContext(); // /project -> global
    expect(field('modelSelector.weakModel').getByRole('combobox')).toHaveValue('provider/available');
  });
});
