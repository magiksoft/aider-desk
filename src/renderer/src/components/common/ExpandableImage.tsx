import { ComponentProps, KeyboardEvent, MouseEvent, useState } from 'react';
import { createPortal } from 'react-dom';
import { IoClose } from 'react-icons/io5';
import { AnimatePresence, motion } from 'framer-motion';
import { FocusTrap } from 'focus-trap-react';
import { useTranslation } from 'react-i18next';

type Props = Pick<ComponentProps<'img'>, 'alt' | 'title' | 'loading' | 'onError'> & {
  src: string;
  thumbnailClassName?: string;
};

export const ExpandableImage = ({ src, alt, title, loading, onError, thumbnailClassName }: Props) => {
  const { t } = useTranslation();
  const [expandedSource, setExpandedSource] = useState<string | null>(null);
  const expanded = expandedSource === src;

  const handleImageClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setExpandedSource(src);
  };

  const handleClose = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setExpandedSource(null);
  };

  const handleExpandedImageClick = (event: MouseEvent<HTMLImageElement>) => {
    event.stopPropagation();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setExpandedSource(null);
    }
  };

  return (
    <>
      <button
        type="button"
        className="inline-flex max-w-full align-middle rounded-md"
        onClick={handleImageClick}
        aria-haspopup="dialog"
        aria-expanded={expanded}
      >
        <img
          src={src}
          alt={alt}
          title={title}
          loading={loading}
          onError={onError}
          className={
            thumbnailClassName ??
            'max-h-40 max-w-[200px] rounded-md border border-border-dark-light cursor-pointer hover:opacity-80 transition-opacity object-contain'
          }
        />
      </button>
      {createPortal(
        <AnimatePresence>
          {expanded && (
            <FocusTrap focusTrapOptions={{ allowOutsideClick: true, escapeDeactivates: false }}>
              <motion.div
                role="dialog"
                aria-modal="true"
                aria-label={alt || t('toolMessage.images', { count: 1 })}
                className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 cursor-pointer p-8"
                onClick={handleClose}
                onKeyDown={handleKeyDown}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <motion.img
                  src={src}
                  alt={alt}
                  title={title}
                  className="max-w-[90vw] max-h-[90vh] object-contain"
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  onClick={handleExpandedImageClick}
                />
                <motion.button
                  type="button"
                  aria-label={t('common.close')}
                  className="fixed top-4 right-4 z-[10000] flex items-center justify-center w-10 h-10 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                  onClick={handleClose}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <IoClose className="w-6 h-6" />
                </motion.button>
              </motion.div>
            </FocusTrap>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
};
