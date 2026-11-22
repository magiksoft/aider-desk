import { ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AigrowProvider } from '@common/agent';

import { Input } from '@/components/common/Input';
import { useEffectiveEnvironmentVariable } from '@/hooks/useEffectiveEnvironmentVariable';

type Props = {
  provider: AigrowProvider;
  onChange: (updated: AigrowProvider) => void;
};

export const AigrowParameters = ({ provider, onChange }: Props) => {
  const { t } = useTranslation();

  const { apiKey } = provider;

  const { environmentVariable: aigrowKeyEnv } = useEffectiveEnvironmentVariable('AIGROW_API_KEY');

  const handleApiKeyChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange({ ...provider, apiKey: e.target.value });
  };

  return (
    <div className="space-y-4">
      <div className="!mt-0 !mb-5">
        <a href="https://aigrow.gg/dashboard/api" target="_blank" rel="noopener noreferrer" className="text-sm text-info-light hover:underline">
          {t('aigrow.getApiKeyLink')}
        </a>
      </div>
      <Input
        label={t('aigrow.apiKey')}
        type="password"
        value={apiKey}
        onChange={handleApiKeyChange}
        placeholder={
          aigrowKeyEnv
            ? t('settings.agent.envVarFoundPlaceholder', {
                source: aigrowKeyEnv.source,
              })
            : t('settings.agent.envVarPlaceholder', {
                envVar: 'AIGROW_API_KEY',
              })
        }
      />
    </div>
  );
};
