import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa';
import { twMerge } from 'tailwind-merge';

import { IconButton } from '@/components/common/IconButton';
import { Tooltip } from '@/components/ui/Tooltip';
import { getPathBasename } from '@/utils/path-utils';

type Props = {
  contexts: string[];
  value: string;
  onChange: (context: string) => void;
  getDisplayName?: (context: string) => string;
  previousTooltip?: ReactNode;
  nextTooltip?: ReactNode;
  className?: string;
};

export const ScopeSelector = ({ contexts, value, onChange, getDisplayName, previousTooltip, nextTooltip, className }: Props) => {
  const { t } = useTranslation();

  const resolveDisplayName = getDisplayName ?? ((context: string) => (context === 'global' ? t('settings.common.scopeGlobal') : getPathBasename(context)));
  const displayName = resolveDisplayName(value);
  const disabled = contexts.length <= 1;

  const handlePrevious = () => {
    const index = contexts.indexOf(value);
    onChange(contexts[(index - 1 + contexts.length) % contexts.length]);
  };
  const handleNext = () => {
    const index = contexts.indexOf(value);
    onChange(contexts[(index + 1) % contexts.length]);
  };

  return (
    <div className={twMerge('flex items-center justify-between gap-1', className)}>
      <IconButton
        icon={<FaChevronLeft className="w-3 h-3" />}
        onClick={handlePrevious}
        tooltip={previousTooltip ?? t('settings.common.previousContext')}
        disabled={disabled}
        className="p-1 flex-shrink-0"
      />
      <Tooltip content={displayName}>
        <div className="text-xs text-text-secondary truncate flex-1 text-center select-none">{displayName}</div>
      </Tooltip>
      <IconButton
        icon={<FaChevronRight className="w-3 h-3" />}
        onClick={handleNext}
        tooltip={nextTooltip ?? t('settings.common.nextContext')}
        disabled={disabled}
        className="p-1 flex-shrink-0"
      />
    </div>
  );
};
