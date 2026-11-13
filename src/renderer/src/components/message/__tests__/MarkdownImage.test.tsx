import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { parseMessageContent } from '../utils';

import { BrowserApi } from '@/api/browser-api';
import { ApiContext, ReadonlyViewContext } from '@/contexts/ApiContext';
import { createMockApi } from '@/__tests__/mocks/api';

vi.mock('@/components/common/CodeBlock', () => ({ CodeBlock: () => null }));

const data = 'data:image/png;base64,aGVsbG8=';
const screenshot = '![Magiksoft project screenshot](agent-browser-screenshots/magiksoft.png)';
const renderMessage = (content = screenshot, readImage = vi.fn().mockResolvedValue(data), readonly = false) => {
  const api = createMockApi({ readImage });
  const result = render(
    <ApiContext.Provider value={api}>
      <ReadonlyViewContext.Provider value={readonly}>
        {parseMessageContent('/project', content, [], true, true, undefined, 'task-id')}
      </ReadonlyViewContext.Provider>
    </ApiContext.Provider>,
  );
  return { ...result, api };
};

describe('Markdown images', () => {
  it('loads the agent screenshot using the project and task identity', async () => {
    const { api } = renderMessage();
    await waitFor(() => expect(screen.getByRole('img')).toHaveAttribute('src', data));
    expect(screen.getByRole('img')).toHaveAttribute('alt', 'Magiksoft project screenshot');
    expect(api.readImage).toHaveBeenCalledWith('/project', 'task-id', 'agent-browser-screenshots/magiksoft.png');
  });

  it('opens a loaded local thumbnail in the shared preview without reading it again', async () => {
    const { api, container } = renderMessage();
    const thumbnail = await screen.findByRole('img', { name: 'Magiksoft project screenshot' });
    expect(thumbnail).toHaveClass('max-h-40', 'max-w-[200px]');
    expect(container.querySelector('p > button > img')).toBe(thumbnail);
    fireEvent.click(screen.getByRole('button', { name: 'Magiksoft project screenshot' }));
    expect(within(screen.getByRole('dialog')).getByRole('img')).toHaveAttribute('src', data);
    expect(api.readImage).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'common.close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(thumbnail).toBeInTheDocument();
  });

  it('works with the browser API', async () => {
    const readImage = vi.fn().mockResolvedValue(data);
    const api = Object.assign(Object.create(BrowserApi.prototype) as BrowserApi, { readImage });
    render(<ApiContext.Provider value={api}>{parseMessageContent('/project', screenshot, [], true, true, undefined, 'task-id')}</ApiContext.Provider>);
    await waitFor(() => expect(screen.getByRole('img')).toHaveAttribute('src', data));
    expect(readImage).toHaveBeenCalledWith('/project', 'task-id', 'agent-browser-screenshots/magiksoft.png');
  });

  it('decodes local file URLs', async () => {
    const { api } = renderMessage('![Screenshot](file:///project/my%20image.png)');
    await waitFor(() => expect(api.readImage).toHaveBeenCalledWith('/project', 'task-id', '/project/my image.png'));
    expect(await screen.findByRole('img')).toHaveAttribute('src', data);
  });

  it('leaves remote images unchanged without local file reads', () => {
    const { api } = renderMessage('![Remote](https://example.com/image.png)');
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://example.com/image.png');
    expect(api.readImage).not.toHaveBeenCalled();
  });

  it('shows alt text if a local file is missing', async () => {
    const readImage = vi.fn().mockRejectedValue(new Error('File not found'));
    renderMessage(screenshot, readImage);
    await waitFor(() => expect(readImage).toHaveBeenCalled());
    expect(screen.getByText('Magiksoft project screenshot')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('shows alt text when the image fails to decode', () => {
    renderMessage('![Remote](https://example.com/image.png)');
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByText('Remote')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('does not read local images in readonly views', () => {
    const { api } = renderMessage(screenshot, undefined, true);
    expect(api.readImage).not.toHaveBeenCalled();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('loads images inside the thinking and answer renderer', async () => {
    const api = createMockApi({ readImage: vi.fn().mockResolvedValue(data) });
    render(<ApiContext.Provider value={api}>{parseMessageContent('/project', screenshot, [], true, true, 'Reasoning', 'task-id')}</ApiContext.Provider>);
    await waitFor(() => expect(screen.getByRole('img')).toHaveAttribute('src', data));
    expect(api.readImage).toHaveBeenCalledWith('/project', 'task-id', 'agent-browser-screenshots/magiksoft.png');
  });

  it('blocks unsafe image URL schemes', () => {
    const { api } = renderMessage('![Unsafe](javascript:alert%281%29)');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(api.readImage).not.toHaveBeenCalled();
  });
});
