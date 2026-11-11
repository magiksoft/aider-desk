import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentProfile, Model, ProviderProfile, SettingsData } from '@common/types';

import { Onboarding } from '../Onboarding';

import { useSettingsStore } from '@/stores/settingsStore';

const mocks = vi.hoisted(() => ({
  saveSettings: vi.fn(),
  navigate: vi.fn(),
  providers: [] as ProviderProfile[],
  models: [] as Model[],
  profiles: [] as AgentProfile[],
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/stores/settingsStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/stores/settingsStore')>()),
  useSaveSettings: () => mocks.saveSettings,
}));
vi.mock('@/contexts/AgentsContext', () => ({
  useAgents: () => ({ profiles: mocks.profiles }),
}));
vi.mock('@/contexts/ModelProviderContext', () => ({
  useModelProviders: () => ({ providers: mocks.providers, models: mocks.models }),
}));
vi.mock('@/components/onboarding/OnboardingProviderSetup', () => ({
  OnboardingProviderSetup: () => <div>Provider setup</div>,
}));
vi.mock('@/components/settings/LanguageSelector', () => ({ LanguageSelector: () => null }));
vi.mock('@/components/settings/agent/AgentSettings', () => ({
  AgentSettings: () => <div>Agent settings</div>,
}));
vi.mock('@/utils/notifications', () => ({ showInfoNotification: vi.fn(), showErrorNotification: vi.fn() }));
vi.mock('@/components/ModelSelector', () => ({
  ModelSelector: ({
    selectedModelId,
    labelOnNull,
    onChange,
  }: {
    selectedModelId: string | null;
    labelOnNull: string;
    onChange: (model: Model | null) => void;
  }) => (
    <select aria-label={labelOnNull} value={selectedModelId ?? ''} onChange={(event) => onChange(event.target.value ? mocks.models[0] : null)}>
      <option value="">{labelOnNull}</option>
      {mocks.models.map((model) => (
        <option key={model.id} value={`${model.providerId}/${model.id}`}>
          {model.id}
        </option>
      ))}
    </select>
  ),
}));

const defaults = {
  language: 'en',
  preferredModels: [],
  taskSettings: { defaultProjectMode: 'agent', defaultTaskMode: 'last' },
  aider: {
    options: '',
    environmentVariables: '',
    autoCommits: true,
    cachingEnabled: false,
    watchFiles: false,
    confirmBeforeEdit: false,
    addRuleFiles: true,
  },
} as unknown as SettingsData;

const next = () => fireEvent.click(screen.getByRole('button', { name: 'common.next' }));
const choosePath = (path: 'agent' | 'aider') => {
  next();
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`onboarding.choice.${path}.title`) }));
  next();
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.providers = [{ id: 'provider', name: 'Provider', provider: { name: 'anthropic' } }] as ProviderProfile[];
  mocks.models = [{ id: 'available', providerId: 'provider' }] as Model[];
  useSettingsStore.getState().setSettingsState(defaults);
});

describe('Onboarding', () => {
  it('preserves the chosen Aider model across navigation and saves it as a global default on finish', async () => {
    render(<Onboarding />);
    choosePath('aider');
    expect(screen.getByText('Provider setup')).toBeInTheDocument();
    next();
    expect(screen.getByRole('heading', { name: 'onboarding.aider.modelTitle' })).toBeInTheDocument();
    expect(screen.queryByText('onboarding.aider.noModels')).not.toBeInTheDocument();
    const mainModel = () => within(screen.getByRole('group', { name: 'modelSelector.mainModel' })).getByRole('combobox');
    fireEvent.change(mainModel(), { target: { value: 'provider/available' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.back' }));
    next();
    expect(mainModel()).toHaveValue('provider/available');
    next();
    fireEvent.click(screen.getByRole('button', { name: 'onboarding.finish' }));
    await waitFor(() =>
      expect(mocks.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          aider: { ...defaults.aider, mainModel: 'provider/available' },
          taskSettings: { ...defaults.taskSettings, defaultProjectMode: 'code' },
          onboardingFinished: true,
        }),
      ),
    );
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
  });

  it('allows provider setup to be skipped and explains how to configure models later', async () => {
    mocks.providers = [];
    mocks.models = [];
    render(<Onboarding />);
    choosePath('aider');
    fireEvent.click(screen.getByRole('button', { name: 'onboarding.skipForNow' }));
    expect(screen.getByText('onboarding.aider.noModels')).toBeInTheDocument();
    next();
    fireEvent.click(screen.getByRole('button', { name: 'onboarding.finish' }));
    await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ aider: defaults.aider, onboardingFinished: true })));
  });

  it('keeps the agent configuration path unchanged', () => {
    render(<Onboarding />);
    choosePath('agent');
    next();
    expect(screen.getByText('Agent settings')).toBeInTheDocument();
    expect(screen.queryByText('onboarding.aider.modelTitle')).not.toBeInTheDocument();
  });
});
