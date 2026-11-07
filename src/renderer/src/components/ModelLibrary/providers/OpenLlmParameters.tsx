import { ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { OpenLlmProvider } from '@common/agent';

import { Input } from '@/components/common/Input';
import { useEffectiveEnvironmentVariable } from '@/hooks/useEffectiveEnvironmentVariable';

type Props = {
  provider: OpenLlmProvider;
  onChange: (updated: OpenLlmProvider) => void;
};

export const OpenLlmParameters = ({ provider, onChange }: Props) => {
  const { t } = useTranslation();

  const baseUrl = provider.baseUrl || '';
  const apiKey = provider.apiKey || '';

  const { environmentVariable: openLlmApiKeyEnv } = useEffectiveEnvironmentVariable('OPENLLM_API_KEY');

  const handleBaseUrlChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange({ ...provider, baseUrl: e.target.value });
  };

  const handleApiKeyChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange({ ...provider, apiKey: e.target.value });
  };

  return (
    <div className="space-y-4">
      <div className="!mt-0 !mb-5">
        <a href="https://docs.openllm.sh/quickstart" target="_blank" rel="noopener noreferrer" className="text-sm text-info-light hover:underline">
          {t('openLlm.docsLink')}
        </a>
      </div>
      <Input label={t('openLlm.baseUrl')} type="text" value={baseUrl} onChange={handleBaseUrlChange} placeholder="http://127.0.0.1:8787/v1" />
      <Input
        label={t('openLlm.apiKey')}
        type="password"
        value={apiKey}
        onChange={handleApiKeyChange}
        placeholder={
          openLlmApiKeyEnv
            ? t('settings.agent.envVarFoundPlaceholder', {
                source: openLlmApiKeyEnv.source,
              })
            : t('settings.agent.envVarPlaceholder', {
                envVar: 'OPENLLM_API_KEY',
              })
        }
      />
      <p className="text-xs text-text-muted">{t('openLlm.apiKeyHint')}</p>
    </div>
  );
};
