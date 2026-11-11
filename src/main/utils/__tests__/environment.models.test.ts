import fs from 'fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsData } from '@common/types';

import { determineMainModel } from '../environment';

vi.mock('@/logger');
vi.mock('@/telemetry', () => ({ getLangfuseEnvironmentVariables: vi.fn(), getPostHogAiderEnvironmentVariables: vi.fn() }));
vi.mock('fs', () => ({ default: { existsSync: vi.fn(() => false), readFileSync: vi.fn() } }));

const settings = (options = '', mainModel?: string | null): SettingsData => ({ aider: { options, mainModel } }) as SettingsData;

describe('determineMainModel', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  it('prefers a selected model over legacy CLI and YAML configuration', () => {
    expect(determineMainModel(settings('--model legacy', 'profile/selected'), [], [], '/project')).toBe('profile/selected');
  });

  it.each(['--model provider/model', '--model=provider/model', '--model "provider/model"', "--model 'provider/model'"])(
    'supports legacy option syntax %s',
    (options) => {
      expect(determineMainModel(settings(options), [], [], '/project')).toBe('provider/model');
    },
  );

  it('reads legacy model YAML configuration', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('model: profile/yaml-model');
    expect(determineMainModel(settings(), [], [], '/project')).toBe('profile/yaml-model');
  });

  it('uses an actual available provider model and does not guess a fallback', () => {
    expect(
      determineMainModel(
        settings(),
        [{ id: 'configured', name: 'Configured', provider: { name: 'anthropic' } }],
        [{ providerId: 'configured', id: 'available' }],
        '/project',
      ),
    ).toBe('configured/available');
    expect(determineMainModel(settings(), [], [], '/project')).toBe('');
  });
});
