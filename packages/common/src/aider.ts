import { DEFAULT_PROVIDER_MODELS } from './agent';
import { AiderSettingsData, Model, ProviderProfile, SettingsData } from './types';

export const resolveAiderSettings = (settings: SettingsData, overrides?: Partial<AiderSettingsData>): SettingsData => ({
  ...settings,
  aider: {
    ...settings.aider,
    ...Object.fromEntries(Object.entries(overrides ?? {}).filter(([, value]) => value !== undefined)),
    environmentVariables: [settings.aider.environmentVariables, overrides?.environmentVariables].filter(Boolean).join('\n'),
  },
});

export const findDefaultAiderModel = (providers: ProviderProfile[], models: Model[]): string | undefined => {
  for (const provider of [...providers].sort((left, right) => left.id.localeCompare(right.id))) {
    if (provider.disabled) {
      continue;
    }
    const availableModels = models.filter((model) => model.providerId === provider.id && !model.isHidden);
    const recommended = DEFAULT_PROVIDER_MODELS[provider.provider.name];
    const model = availableModels.find((model) => model.id === recommended) ?? availableModels[0];
    if (model) {
      return `${provider.id}/${model.id}`;
    }
  }
  return undefined;
};
