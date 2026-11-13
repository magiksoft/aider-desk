import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ExpandableImage } from '../ExpandableImage';

import { MessageImages } from '@/components/message/MessageImages';

const src = 'https://example.com/screenshot.png';

const openImage = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Screenshot' }));
  return screen.getByRole('dialog', { name: 'Screenshot' });
};

describe('ExpandableImage', () => {
  it('renders a small thumbnail with a keyboard-accessible trigger', () => {
    render(<ExpandableImage src={src} alt="Screenshot" title="Preview" loading="lazy" />);
    const image = screen.getByRole('img', { name: 'Screenshot' });
    expect(image).toHaveClass('max-h-40', 'max-w-[200px]');
    expect(image).toHaveAttribute('title', 'Preview');
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(screen.getByRole('button', { name: 'Screenshot' }).tagName).toBe('BUTTON');
    expect(screen.getByRole('button', { name: 'Screenshot' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the full image in a portal without adding block elements to Markdown paragraphs', () => {
    const { container } = render(
      <p>
        <ExpandableImage src={src} alt="Screenshot" />
      </p>,
    );
    const dialog = openImage();
    expect(container.querySelector('p > button > img')).toBeInTheDocument();
    expect(container.querySelector('div')).not.toBeInTheDocument();
    expect(document.body).toContainElement(dialog);
    expect(within(dialog).getByRole('img')).toHaveAttribute('src', src);
    expect(within(dialog).getByRole('img')).toHaveClass('max-w-[90vw]', 'max-h-[90vh]');
    expect(screen.getByRole('button', { name: 'Screenshot' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes with the close button', async () => {
    render(<ExpandableImage src={src} alt="Screenshot" />);
    openImage();
    fireEvent.click(screen.getByRole('button', { name: 'common.close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('closes on backdrop click but not on expanded-image click', async () => {
    render(<ExpandableImage src={src} alt="Screenshot" />);
    const dialog = openImage();
    fireEvent.click(within(dialog).getByRole('img'));
    expect(dialog).toBeInTheDocument();
    fireEvent.click(dialog);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('closes on Escape without forwarding events to the surrounding message', async () => {
    const handleClick = vi.fn();
    const handleKeyDown = vi.fn();
    render(
      <div onClick={handleClick} onKeyDown={handleKeyDown}>
        <ExpandableImage src={src} alt="Screenshot" />
      </div>,
    );
    openImage();
    fireEvent.keyDown(screen.getByRole('button', { name: 'common.close' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(handleClick).not.toHaveBeenCalled();
    expect(handleKeyDown).not.toHaveBeenCalled();
  });

  it('preserves custom thumbnail styling and error handling', () => {
    const handleError = vi.fn();
    render(<ExpandableImage src={src} alt="Screenshot" thumbnailClassName="custom-thumbnail" onError={handleError} />);
    const image = screen.getByRole('img');
    expect(image).toHaveClass('custom-thumbnail');
    fireEvent.error(image);
    expect(handleError).toHaveBeenCalledOnce();
  });

  it('dismisses the preview when the source changes', async () => {
    const { rerender } = render(<ExpandableImage src={src} alt="Screenshot" />);
    openImage();
    rerender(<ExpandableImage src="https://example.com/other.png" alt="Other" />);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://example.com/other.png');
  });
});

describe('MessageImages', () => {
  it('uses the shared preview for the selected attachment', () => {
    render(<MessageImages images={[src, 'https://example.com/second.png']} altPrefix="Attachment" />);
    fireEvent.click(screen.getByRole('button', { name: 'Attachment 2' }));
    expect(within(screen.getByRole('dialog')).getByRole('img')).toHaveAttribute('src', 'https://example.com/second.png');
    expect(screen.getAllByRole('img')).toHaveLength(3);
  });

  it('renders nothing for an empty list', () => {
    const { container } = render(<MessageImages images={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
