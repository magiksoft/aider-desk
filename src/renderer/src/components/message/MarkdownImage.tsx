import { useEffect, useState } from 'react';

import { getFileLinkPath } from './markdown-url';

import { ExpandableImage } from '@/components/common/ExpandableImage';
import { useIsReadonlyView, useOptionalApi } from '@/contexts/ApiContext';

const getLocalPath = (src: string): string | null => {
  const filePath = getFileLinkPath(src);
  if (filePath) {
    return filePath;
  }
  if (/^[a-z]:[\\/]/i.test(src)) {
    return src;
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(src) || src.startsWith('//')) {
    return null;
  }
  try {
    return decodeURIComponent(src);
  } catch {
    return null;
  }
};

type Props = {
  src?: string | Blob;
  alt?: string;
  title?: string;
  baseDir: string;
  taskId?: string;
};

export const MarkdownImage = ({ src, alt, title, baseDir, taskId }: Props) => {
  const api = useOptionalApi();
  const readonly = useIsReadonlyView();
  const source = typeof src === 'string' ? src : '';
  const localPath = source ? getLocalPath(source) : null;
  const imageKey = JSON.stringify([baseDir, taskId, source, readonly]);
  const [loaded, setLoaded] = useState<{ key: string; data: string } | null>(null);
  const [failedSource, setFailedSource] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (localPath && api && taskId && !readonly) {
      void api.readImage(baseDir, taskId, localPath).then(
        (data) => {
          if (!cancelled) {
            setLoaded({ key: imageKey, data });
          }
        },
        () => {
          if (!cancelled) {
            setFailedSource(imageKey);
          }
        },
      );
    }
    return () => {
      cancelled = true;
    };
  }, [api, baseDir, taskId, localPath, imageKey, readonly]);

  const imageSource = localPath ? (!readonly && loaded?.key === imageKey ? loaded.data : undefined) : source;
  const handleError = () => {
    setFailedSource(imageKey);
  };

  if (!imageSource || failedSource === imageKey) {
    return <span title={title}>{alt}</span>;
  }

  return <ExpandableImage key={imageKey} src={imageSource} alt={alt} title={title} loading="lazy" onError={handleError} />;
};
