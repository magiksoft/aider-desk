import { useTranslation } from 'react-i18next';
import { getProviderModelId } from '@common/agent';
import { Model, ProviderProfile } from '@common/types';

import { ModelSelector } from '@/components/ModelSelector';

type Props = {
  value: string | null;
  resolvedModelId?: string;
  isMainModel: boolean;
  automatic: boolean;
  inherited: boolean;
  models: Model[];
  providers: ProviderProfile[];
  preferredModelIds: string[];
  onChange: (modelId: string | null) => void;
};

export const AiderModelSetting = ({ value, resolvedModelId, isMainModel, automatic, inherited, models, providers, preferredModelIds, onChange }: Props) => {
  const { t } = useTranslation();
  const handleChange = (model: Model | null) => {
    onChange(model ? getProviderModelId(model) : null);
  };
  const hints = [automatic && t('settings.aider.auto'), inherited && t('settings.aider.inherited')].filter(Boolean);

  return (
    <div className="w-full p-2 bg-bg-secondary-light border-2 border-border-default rounded focus-within:outline-none focus-within:border-border-light">
      <ModelSelector
        className="w-full justify-between"
        models={models}
        providers={providers}
        selectedModelId={value}
        resolvedModelId={inherited ? undefined : resolvedModelId}
        selectionHint={hints.length ? `(${hints.join(', ')})` : undefined}
        onChange={handleChange}
        preferredModelIds={preferredModelIds}
        labelOnNull={t(isMainModel ? 'settings.aider.automaticModel' : 'settings.aider.inheritMainModel')}
        selectedLabelOnNull={t('settings.aider.inherited')}
        usePortal
      />
    </div>
  );
};
