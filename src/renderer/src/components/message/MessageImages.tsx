import { ExpandableImage } from '@/components/common/ExpandableImage';

type Props = {
  images: string[];
  altPrefix?: string;
  thumbnailClassName?: string;
};

export const MessageImages = ({ images, altPrefix = 'Image', thumbnailClassName }: Props) => {
  if (images.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {images.map((src, index) => (
        <ExpandableImage key={index} src={src} alt={`${altPrefix} ${index + 1}`} thumbnailClassName={thumbnailClassName} />
      ))}
    </div>
  );
};
