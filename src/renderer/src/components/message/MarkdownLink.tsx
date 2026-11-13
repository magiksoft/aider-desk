import { ComponentProps, MouseEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getFileLinkPath, getRelativeFileLinkPath } from './markdown-url';

import { BrowserApi } from '@/api/browser-api';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useIsReadonlyView, useOptionalApi } from '@/contexts/ApiContext';
import { showErrorNotification, showInfoNotification } from '@/utils/notifications';
import { useProjectTaskWorktreePath } from '@/stores/projectStore';

type Props = Pick<ComponentProps<'a'>, 'href' | 'children' | 'title'> & {
  baseDir?: string;
  taskId?: string;
};

export const MarkdownLink = ({ href, children, title, baseDir = '', taskId = '' }: Props) => {
  const api = useOptionalApi();
  const readonly = useIsReadonlyView();
  const { t } = useTranslation();
  const [showDownload, setShowDownload] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const worktreePath = useProjectTaskWorktreePath(baseDir, taskId);
  const filePath = href ? (getFileLinkPath(href) ?? getRelativeFileLinkPath(href, worktreePath ?? baseDir)) : null;

  const handleClick = async (event: MouseEvent<HTMLAnchorElement>) => {
    if (!filePath) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (api instanceof BrowserApi || readonly) {
      setShowDownload(true);
      return;
    }
    try {
      if (!api || !(await api.openPath(filePath))) {
        showErrorNotification(t('fileLink.openError'));
      }
    } catch {
      showErrorNotification(t('fileLink.openError'));
    }
  };

  const handleCancel = () => {
    if (!downloading) {
      setShowDownload(false);
    }
  };

  const handleDownload = async () => {
    if (!(api instanceof BrowserApi) || !filePath || downloading) {
      return;
    }
    setDownloading(true);
    try {
      await api.downloadFile(filePath);
      setShowDownload(false);
    } catch {
      showErrorNotification(t('fileLink.downloadError'));
    } finally {
      setDownloading(false);
    }
  };

  const handleCopyPath = async () => {
    if (!filePath) {
      return;
    }
    try {
      await api?.writeToClipboard(filePath);
      showInfoNotification(t('messages.copied'));
    } catch {
      showErrorNotification(t('fileLink.copyError'));
    }
  };

  if (!href) {
    return <span>{children}</span>;
  }

  return (
    <>
      <a href={href} title={title} className="text-info-light hover:underline" target="_blank" rel="noopener noreferrer" onClick={handleClick}>
        {children}
      </a>
      {showDownload && (
        <ConfirmDialog
          title={t('fileLink.downloadTitle')}
          onConfirm={handleDownload}
          onCancel={handleCancel}
          confirmButtonText={t('fileLink.download')}
          disabled={downloading || readonly}
          closeOnEscape
          additionalAction={{ label: t('fileLink.copyPath'), onClick: handleCopyPath }}
        >
          <p className="text-sm">{t(readonly ? 'fileLink.readonly' : 'fileLink.downloadPrompt')}</p>
          <p className="text-xs break-all mt-3">{filePath}</p>
        </ConfirmDialog>
      )}
    </>
  );
};
