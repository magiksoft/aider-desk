import { describe, expect, it } from 'vitest';

import { findDefaultAiderModel, resolveAiderSettings } from '../aider';
import { DEFAULT_PROVIDER_MODELS } from '../agent';
import { AiderSettingsData, Model, ProviderProfile, SettingsData } from '../types';

const aider: AiderSettingsData = {
  options: '--map-tokens 1024',
  environmentVariables: 'SHARED_FLAG=global\nGLOBAL_FLAG=keep',
  addRuleFiles: true,
  autoCommits: true,
  cachingEnabled: false,
  watchFiles: false,
  confirmBeforeEdit: false,
  mainModel: 'anthropic/main',
  weakModel: 'anthropic/weak',
};
const settings = { aider } as SettingsData;
const provider = (id: string, disabled = false): ProviderProfile => ({ id, name: id, provider: { name: 'anthropic' }, disabled });
const model = (id: string, providerId = 'anthropic', isHidden = false): Model => ({ id, providerId, isHidden });

describe('resolveAiderSettings', () => {
  it('inherits global settings without mutating them', () => {
    const resolved = resolveAiderSettings(settings, { autoCommits: false, mainModel: null, weakModel: null });
    expect(resolved.aider).toMatchObject({ autoCommits: false, mainModel: null, weakModel: null, options: '--map-tokens 1024' });
    expect(settings.aider).toEqual(aider);
    expect(resolveAiderSettings(settings).aider).toEqual(aider);
  });

  it('merges environment keys with project values winning and preserves unrelated global keys', () => {
    const resolved = resolveAiderSettings(settings, { environmentVariables: 'SHARED_FLAG=project\nPROJECT_FLAG=extra' });
    expect(resolved.aider.environmentVariables).toBe('SHARED_FLAG=global\nGLOBAL_FLAG=keep\nSHARED_FLAG=project\nPROJECT_FLAG=extra');
  });
});

describe('findDefaultAiderModel', () => {
  it('prefers a recommended model only when it is available', () => {
    const recommended = DEFAULT_PROVIDER_MODELS.anthropic!;
    expect(findDefaultAiderModel([provider('anthropic')], [model('other'), model(recommended)])).toBe(`anthropic/${recommended}`);
    expect(findDefaultAiderModel([provider('anthropic')], [model('other')])).toBe('anthropic/other');
  });

  it('skips disabled providers, hidden models, and providers without models', () => {
    expect(
      findDefaultAiderModel(
        [provider('a-disabled', true), provider('b-empty'), provider('c-hidden'), provider('d-working')],
        [model('disabled', 'a-disabled'), model('hidden', 'c-hidden', true), model('available', 'd-working')],
      ),
    ).toBe('d-working/available');
  });

  it('returns no model rather than an unavailable hardcoded fallback', () => {
    expect(findDefaultAiderModel([provider('anthropic')], [])).toBeUndefined();
    expect(findDefaultAiderModel([], [model('orphan')])).toBeUndefined();
  });

  it('uses a deterministic provider order in the UI and main process', () => {
    const providers = [provider('z'), provider('a')];
    expect(findDefaultAiderModel(providers, [model('z-model', 'z'), model('a-model', 'a')])).toBe('a/a-model');
    expect(providers[0].id).toBe('z');
  });
});
