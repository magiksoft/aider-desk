import { ComponentProps, ReactNode } from 'react';
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import { HiChevronDown } from 'react-icons/hi2';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { Button } from '@/components/common/Button';

export type SplitButtonAction = {
  id: string;
  label: ReactNode;
  onClick: () => void;
  icon?: ReactNode;
  disabled?: boolean;
};

type Props = ComponentProps<typeof Button> & {
  actions: SplitButtonAction[];
  menuLabel?: string;
  containerClassName?: string;
};

export const SplitButton = ({
  children,
  actions,
  variant = 'contained',
  color = 'primary',
  size = 'md',
  disabled = false,
  className,
  containerClassName,
  menuLabel,
  ...buttonProps
}: Props) => {
  const { t } = useTranslation();

  return (
    <Menu as="div" className={clsx('inline-flex items-stretch', containerClassName)}>
      <Button {...buttonProps} variant={variant} color={color} size={size} disabled={disabled} className={twMerge('rounded-r-none', className)}>
        {children}
      </Button>
      <MenuButton
        as={Button}
        variant={variant}
        color={color}
        size={size}
        disabled={disabled || actions.length === 0}
        aria-label={menuLabel ?? t('splitButton.moreActions')}
        className="relative rounded-l-none border-l-0 px-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border-default"
      >
        <span aria-hidden="true" className="absolute left-0 inset-y-1/4 border-l border-current opacity-30" />
        <HiChevronDown aria-hidden="true" className="size-4" />
      </MenuButton>
      <MenuItems
        anchor="bottom end"
        portal
        modal={false}
        className="z-50 min-w-40 max-w-[calc(100vw-1rem)] max-h-64 overflow-y-auto rounded-md border border-border-default bg-bg-secondary-light p-1 shadow-lg focus:outline-none [--anchor-gap:4px]"
      >
        {actions.map((action) => (
          <MenuItem
            key={action.id}
            as="button"
            type="button"
            disabled={disabled || action.disabled}
            onClick={action.onClick}
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-text-primary data-[focus]:bg-bg-tertiary data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed"
          >
            {action.icon && (
              <span aria-hidden="true" className="shrink-0">
                {action.icon}
              </span>
            )}
            <span>{action.label}</span>
          </MenuItem>
        ))}
      </MenuItems>
    </Menu>
  );
};
