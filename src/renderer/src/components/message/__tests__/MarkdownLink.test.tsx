import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseMessageContent } from '../utils';
import { getFileLinkPath } from '../markdown-url';

import type { ApplicationAPI } from '@common/api';

import { BrowserApi } from '@/api/browser-api';
import { ApiContext, ReadonlyViewContext } from '@/contexts/ApiContext';
import { createMockApi } from '@/__tests__/mocks/api';
import { showErrorNotification } from '@/utils/notifications';

vi.mock('@/utils/notifications', () => ({ showErrorNotification: vi.fn(), showInfoNotification: vi.fn() }));
vi.mock('@/components/common/CodeBlock', () => ({ CodeBlock: () => null }));

const href = 'file:///home/user/.agent/my%20mockup.html';
const path = '/home/user/.agent/my mockup.html';
const downloadFile = vi.fn();
const writeToClipboard = vi.fn();
const browserApi = Object.assign(Object.create(BrowserApi.prototype) as BrowserApi, { downloadFile, writeToClipboard });
const renderMessage = (api: ApplicationAPI, content = `[Mockup](${href})`, readonly = false) =>
  render(
    <ApiContext.Provider value={api}>
      <ReadonlyViewContext.Provider value={readonly}>{parseMessageContent('', content, [], true)}</ReadonlyViewContext.Provider>
    </ApiContext.Provider>,
  );

describe('file links in Markdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    downloadFile.mockResolvedValue(undefined);
    writeToClipboard.mockResolvedValue(undefined);
  });

  it('preserves file URLs and opens decoded paths in the desktop app', async () => {
    const api = createMockApi({ openPath: vi.fn().mockResolvedValue(true) });
    renderMessage(api);
    expect(screen.getByRole('link')).toHaveAttribute('href', href);
    fireEvent.click(screen.getByRole('link'));
    await waitFor(() => expect(api.openPath).toHaveBeenCalledWith(path));
    expect(screen.queryByText('fileLink.downloadPrompt')).not.toBeInTheDocument();
  });

  it.each(['/tmp/aiderdesk-skill-proof.png', '/tmp/aiderdesk-skill-order-proof.json', '/tmp/my%20proof.json'])(
    'opens absolute path link %s in the desktop app',
    async (url) => {
      const api = createMockApi({ openPath: vi.fn().mockResolvedValue(true) });
      renderMessage(api, `[Proof](${url})`);
      fireEvent.click(screen.getByRole('link'));
      await waitFor(() => expect(api.openPath).toHaveBeenCalledWith(decodeURIComponent(url)));
    },
  );

  it('asks before downloading an absolute path link in the browser', async () => {
    renderMessage(browserApi, '[JSON proof](/tmp/proof.json)');
    fireEvent.click(screen.getByRole('link'));
    expect(screen.getByText('fileLink.downloadPrompt')).toBeInTheDocument();
    expect(downloadFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'fileLink.download' }));
    await waitFor(() => expect(downloadFile).toHaveBeenCalledWith('/tmp/proof.json'));
  });

  it('keeps absolute path downloads disabled in readonly views', () => {
    const api = createMockApi();
    renderMessage(api, '[Proof](/tmp/proof.json)', true);
    fireEvent.click(screen.getByRole('link'));
    expect(screen.getByRole('button', { name: 'fileLink.download' })).toBeDisabled();
    expect(api.openPath).not.toHaveBeenCalled();
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it.each(['#section', 'https://example.com/page', '//example.com/page'])('preserves non-file link %s', (url) => {
    const api = createMockApi();
    renderMessage(api, `[Link](${url})`);
    expect(screen.getByRole('link')).toHaveAttribute('href', url);
    fireEvent.click(screen.getByRole('link'));
    expect(api.openPath).not.toHaveBeenCalled();
    expect(screen.queryByText('fileLink.downloadPrompt')).not.toBeInTheDocument();
  });

  it('reports desktop opening failures', async () => {
    renderMessage(createMockApi({ openPath: vi.fn().mockResolvedValue(false) }));
    fireEvent.click(screen.getByRole('link'));
    await waitFor(() => expect(showErrorNotification).toHaveBeenCalledWith('fileLink.openError'));
  });

  it('asks before downloading and allows cancellation without a request', () => {
    renderMessage(browserApi);
    fireEvent.click(screen.getByRole('link'));
    expect(screen.getByText('fileLink.downloadPrompt')).toBeInTheDocument();
    expect(screen.getByText(path)).toBeInTheDocument();
    expect(downloadFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
    expect(screen.queryByText('fileLink.downloadPrompt')).not.toBeInTheDocument();
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it('downloads only after confirmation', async () => {
    renderMessage(browserApi);
    fireEvent.click(screen.getByRole('link'));
    fireEvent.click(screen.getByRole('button', { name: 'fileLink.download' }));
    await waitFor(() => expect(downloadFile).toHaveBeenCalledWith(path));
    await waitFor(() => expect(screen.queryByText('fileLink.downloadPrompt')).not.toBeInTheDocument());
  });

  it('copies the decoded path without downloading', async () => {
    renderMessage(browserApi);
    fireEvent.click(screen.getByRole('link'));
    fireEvent.click(screen.getByRole('button', { name: 'fileLink.copyPath' }));
    await waitFor(() => expect(writeToClipboard).toHaveBeenCalledWith(path));
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it('reports failed downloads and leaves the dialog open to retry', async () => {
    downloadFile.mockRejectedValue(new Error('404'));
    renderMessage(browserApi);
    fireEvent.click(screen.getByRole('link'));
    fireEvent.click(screen.getByRole('button', { name: 'fileLink.download' }));
    await waitFor(() => expect(showErrorNotification).toHaveBeenCalledWith('fileLink.downloadError'));
    expect(screen.getByText('fileLink.downloadPrompt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'fileLink.download' })).toBeEnabled();
  });

  it('does not allow file downloads in a readonly view', () => {
    renderMessage(createMockApi(), undefined, true);
    fireEvent.click(screen.getByRole('link'));
    expect(screen.getByText('fileLink.readonly')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'fileLink.download' })).toBeDisabled();
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it('keeps ordinary web links unchanged', () => {
    renderMessage(createMockApi(), '[Website](https://example.com/page)');
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://example.com/page');
    expect(screen.getByRole('link')).toHaveAttribute('target', '_blank');
  });

  it.each(['javascript:alert%281%29', 'data:text/html,test', 'file://remote/share/file.html', 'file:///tmp/bad%00.html'])(
    'does not create navigable links for unsafe URL %s',
    (url) => {
      renderMessage(createMockApi(), `[Unsafe](${url})`);
      expect(screen.getByText('Unsafe')).toBeInTheDocument();
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    },
  );

  it('does not render local images without a task identity', () => {
    renderMessage(createMockApi(), `![Local image](${href})`);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('Local image')).toBeInTheDocument();
  });
});

describe('file URL paths', () => {
  it.each([
    ['file:///tmp/a%20b.html', '/tmp/a b.html'],
    ['file://localhost/tmp/a.html', '/tmp/a.html'],
    ['file:///C:/Users/me/mockup.html', 'C:/Users/me/mockup.html'],
    ['file:///tmp/mockup.html#section', '/tmp/mockup.html'],
    ['/tmp/proof.png', '/tmp/proof.png'],
    ['/tmp/my%20proof.json', '/tmp/my proof.json'],
    ['/tmp/proof.html#section', '/tmp/proof.html'],
    ['//example.com/proof.json', null],
    ['/%2fremote/share', null],
    ['/tmp/%5cremote', null],
    ['/tmp/bad%00.json', null],
    ['/tmp/%zz', null],
    ['/tmp/\\remote', null],
    ['#section', null],
    ['relative/proof.json', null],
    ['https://example.com', null],
    ['file://remote/share/file.html', null],
    ['file:///tmp/%zz', null],
    ['file:///tmp/a%00.html', null],
    ['file:///%2fremote/share', null],
    ['file:///tmp/%5cremote', null],
  ])('converts %s to %s', (url, expected) => {
    expect(getFileLinkPath(url)).toBe(expected);
  });
});
