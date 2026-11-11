import { ReactNode, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { FaTimes } from 'react-icons/fa';

import { Button } from '@/components/common/Button';
import { IconButton } from '@/components/common/IconButton';

type Props = {
  label: string;
  projectScoped: boolean;
  overridden: boolean;
  onOverride: () => void;
  onClear: () => void;
  children: ReactNode;
  inline?: boolean;
};

export const AiderSettingField = ({ label, projectScoped, overridden, onOverride, onClear, children, inline = false }: Props) => {
  const { t } = useTranslation();
  const labelId = useId();

  const overrideControl =
    projectScoped &&
    (overridden ? (
      <IconButton
        icon={<FaTimes className="w-3 h-3" />}
        onClick={onClear}
        tooltip={t('settings.agent.clearOverride')}
        className="p-1 hover:bg-bg-tertiary-emphasis hover:text-text-error rounded-sm flex-shrink-0"
      />
    ) : (
      <Button variant="text" size="xs" onClick={onOverride} className="flex-shrink-0">
        {t('settings.agent.override')}
      </Button>
    ));

  if (inline) {
    return (
      <div className="flex items-center justify-between gap-2 min-h-[1.75rem]">
        <fieldset aria-label={label} disabled={projectScoped && !overridden} className="min-w-0 flex-1 disabled:opacity-60 disabled:pointer-events-none">
          {children}
        </fieldset>
        {overrideControl}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs text-text-primary">
        <span id={labelId}>{label}</span>
        {overrideControl}
      </div>
      <fieldset aria-labelledby={labelId} disabled={projectScoped && !overridden} className="min-w-0 disabled:opacity-60 disabled:pointer-events-none">
        {children}
      </fieldset>
    </div>
  );
};
