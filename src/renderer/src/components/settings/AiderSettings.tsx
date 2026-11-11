import { ChangeEvent, ReactNode, useState } from 'react';
import { HiEye } from 'react-icons/hi';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { AiderSettingsData, ProjectData, SettingsData } from '@common/types';
import { findDefaultAiderModel, resolveAiderSettings } from '@common/aider';

import { AiderSettingField } from './AiderSettingField';
import { AiderModelSetting } from './AiderModelSetting';

import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Section } from '@/components/common/Section';
import { TextArea } from '@/components/common/TextArea';
import { Checkbox } from '@/components/common/Checkbox';
import { ScopeSelector } from '@/components/common/ScopeSelector';
import { useModelProviders } from '@/contexts/ModelProviderContext';
import { getPathBasename } from '@/utils/path-utils';

const OPTIONS_DOCS_URL = 'https://aider.chat/docs/config/options.html';

type Props = {
  settings: SettingsData;
  setSettings: (settings: SettingsData) => void;
  openProjects?: ProjectData[];
  projectOverrides?: Record<string, Partial<AiderSettingsData>>;
  onProjectOverridesChange?: (baseDir: string, overrides: Partial<AiderSettingsData>) => void;
  initialContext?: string;
  initialShowEnvVars?: boolean;
  onboarding?: boolean;
};

export const AiderSettings = ({
  settings,
  setSettings,
  openProjects = [],
  projectOverrides = {},
  onProjectOverridesChange,
  initialContext = 'global',
  initialShowEnvVars = false,
  onboarding = false,
}: Props) => {
  const { t } = useTranslation();
  const { models, providers } = useModelProviders();
  const [context, setContext] = useState(initialContext);
  const [showEnvVars, setShowEnvVars] = useState(initialShowEnvVars);
  const contexts = ['global', ...openProjects.map((project) => project.baseDir)];
  const projectScoped = context !== 'global';
  const overrides = projectOverrides[context] ?? {};
  const effectiveSettings = resolveAiderSettings(settings, projectScoped ? overrides : undefined).aider;
  const mainModel = effectiveSettings.mainModel || findDefaultAiderModel(providers, models);

  const handleContextChange = (value: string) => {
    setShowEnvVars(false);
    setContext(value);
  };
  const handleShowEnvVars = () => {
    setShowEnvVars(true);
  };
  const getContextDisplayName = () => (context === 'global' ? t('settings.aider.globalSettings') : getPathBasename(context));
  const changeSetting = <K extends keyof AiderSettingsData>(key: K, value: AiderSettingsData[K]) => {
    if (projectScoped) {
      const next = { ...overrides };
      if (value === undefined) {
        delete next[key];
      } else {
        next[key] = value;
      }
      onProjectOverridesChange?.(context, next);
    } else {
      setSettings({ ...settings, aider: { ...settings.aider, [key]: value } });
    }
  };
  const renderField = (key: keyof AiderSettingsData, label: string, content: ReactNode, inline = false) => {
    const handleOverride = () => {
      changeSetting(key, key === 'environmentVariables' ? '' : (settings.aider[key] ?? null));
    };
    const handleClear = () => {
      changeSetting(key, undefined);
    };
    return (
      <AiderSettingField
        key={key}
        label={label}
        projectScoped={projectScoped}
        overridden={overrides[key] !== undefined}
        onOverride={handleOverride}
        onClear={handleClear}
        inline={inline}
      >
        {content}
      </AiderSettingField>
    );
  };
  const renderModel = (key: 'mainModel' | 'weakModel' | 'architectModel') => {
    const value = effectiveSettings[key] ?? null;
    const handleChange = (modelId: string | null) => {
      changeSetting(key, modelId);
    };
    return renderField(
      key,
      t(`modelSelector.${key}`),
      <AiderModelSetting
        value={value}
        resolvedModelId={value || mainModel}
        isMainModel={key === 'mainModel'}
        automatic={key === 'mainModel' && !value}
        inherited={(projectScoped && overrides[key] === undefined) || (key !== 'mainModel' && !value)}
        models={models}
        providers={providers}
        preferredModelIds={settings.preferredModels}
        onChange={handleChange}
      />,
    );
  };
  const renderBoolean = (key: 'autoCommits' | 'cachingEnabled' | 'watchFiles' | 'confirmBeforeEdit' | 'addRuleFiles') => {
    const handleChange = (checked: boolean) => {
      changeSetting(key, checked);
    };
    const label = t(`settings.aider.${key === 'addRuleFiles' ? 'addRuleFilesLabel' : key}`);
    const tooltip = key === 'addRuleFiles' ? t('settings.aider.addRuleFiles').replace(/<\/?file>/g, '') : undefined;
    return renderField(
      key,
      label,
      <Checkbox label={label} tooltip={tooltip} checked={effectiveSettings[key]} onChange={handleChange} className="w-fit text-text-primary" />,
      true,
    );
  };
  const handleOptionsChange = (event: ChangeEvent<HTMLInputElement>) => {
    changeSetting('options', event.target.value);
  };
  const handleEnvironmentChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    changeSetting('environmentVariables', event.target.value);
  };

  const advancedSettings = (
    <>
      <Section id="aider-options" title={t('settings.aider.options')}>
        <div className="px-4 py-5 space-y-3">
          {renderBoolean('autoCommits')}
          {renderBoolean('cachingEnabled')}
          {renderBoolean('watchFiles')}
          {renderBoolean('confirmBeforeEdit')}
          {renderField(
            'options',
            t('settings.aider.additionalOptions'),
            <Input
              type="text"
              value={effectiveSettings.options}
              spellCheck={false}
              onChange={handleOptionsChange}
              placeholder={t('settings.aider.optionsPlaceholder')}
            />,
          )}
          <p className="text-xs text-text-secondary">
            {t('settings.aider.optionsDocumentation')}{' '}
            <a href={OPTIONS_DOCS_URL} target="_blank" rel="noopener noreferrer" className="text-info-lighter hover:text-info-lightest">
              {OPTIONS_DOCS_URL}
            </a>
          </p>
        </div>
      </Section>
      <Section id="aider-env-vars" title={t('settings.aider.environmentVariables')}>
        <div className="px-4 py-5 space-y-2">
          {renderField(
            'environmentVariables',
            t('settings.aider.environmentVariables'),
            <div className="relative">
              <TextArea
                value={projectScoped ? (overrides.environmentVariables ?? '') : settings.aider.environmentVariables}
                onChange={handleEnvironmentChange}
                spellCheck={false}
                className="min-h-[200px]"
                placeholder={t('settings.aider.envVarsPlaceholder')}
              />
              {!showEnvVars && (
                <div className="absolute inset-[3px] bottom-[9px] bg-bg-primary-light-strong backdrop-blur-sm flex items-center justify-center rounded-sm">
                  <Button variant="text" color="secondary" onClick={handleShowEnvVars} size="sm">
                    <HiEye className="mr-2" />
                    {t('settings.common.showSecrets')}
                  </Button>
                </div>
              )}
            </div>,
          )}
          <p className="text-xs text-text-secondary">{t('settings.aider.projectEnvironmentHint')}</p>
        </div>
      </Section>
      <Section id="aider-context" title={t('settings.aider.context')}>
        <div className="px-4 py-5">{renderBoolean('addRuleFiles')}</div>
      </Section>
    </>
  );

  return (
    <div className="space-y-5">
      {!onboarding && (
        <ScopeSelector
          contexts={contexts}
          value={context}
          onChange={handleContextChange}
          getDisplayName={getContextDisplayName}
          className="min-w-[240px] max-w-[360px]"
        />
      )}
      <Section id="aider-models" title={t('settings.aider.models')}>
        <div className={clsx('px-4 py-5', !onboarding && 'grid grid-cols-1 lg:grid-cols-3 gap-x-4 gap-y-4')}>
          {renderModel('mainModel')}
          {!onboarding && renderModel('weakModel')}
          {!onboarding && renderModel('architectModel')}
        </div>
      </Section>
      {onboarding ? (
        <details className="border border-border-default-dark rounded-md p-4">
          <summary className="text-sm font-medium text-text-primary cursor-pointer select-none">{t('onboarding.aider.advancedSettings')}</summary>
          <div className="space-y-5 pt-6">
            <Section title={t('settings.aider.models')}>
              <div className="px-4 py-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
                {renderModel('weakModel')}
                {renderModel('architectModel')}
              </div>
            </Section>
            {advancedSettings}
          </div>
        </details>
      ) : (
        advancedSettings
      )}
    </div>
  );
};
