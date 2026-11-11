import { ReactNode } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiderSettingsData, ProjectData, SettingsData } from '@common/types';
import { ApplicationAPI } from '@common/api';

import { SettingsPage } from '../SettingsPage';

import { useSettingsStore, useSaveSettings } from '@/stores/settingsStore';
import { useAgents } from '@/contexts/AgentsContext';
import { useApi } from '@/contexts/ApiContext';
import { showSuccessNotification, showErrorNotification } from '@/utils/notifications';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: vi.fn() },
  }),
}));

// Mock contexts
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: vi.fn(),
  useSaveSettings: vi.fn(),
  setTheme: vi.fn(),
  setFont: vi.fn(),
  setFontSize: vi.fn(),
}));

vi.mock('@/contexts/AgentsContext', () => ({
  useAgents: vi.fn(),
}));

vi.mock('@/contexts/ApiContext', () => ({
  useApi: vi.fn(),
}));

vi.mock('@/utils/notifications', () => ({
  showSuccessNotification: vi.fn(),
  showErrorNotification: vi.fn(),
}));

// Mock components
vi.mock('../../common/ModalOverlayLayout', () => ({
  ModalOverlayLayout: ({ children, title }: { children: ReactNode; title: string }) => (
    <div data-testid="modal-overlay">
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

vi.mock('../../../pages/Settings', () => ({
  Settings: ({
    updateSettings,
    onAiderProjectOverridesChange,
  }: {
    updateSettings: (settings: Partial<SettingsData>) => void;
    onAiderProjectOverridesChange: (baseDir: string, overrides: Partial<AiderSettingsData>) => void;
  }) => (
    <div data-testid="settings-content">
      <button onClick={() => updateSettings({ language: 'zh' })}>Change Language</button>
      <button onClick={() => onAiderProjectOverridesChange('/project', { mainModel: 'provider/model', weakModel: null })}>Change Aider Project</button>
      <button onClick={() => onAiderProjectOverridesChange('/project', {})}>Clear Aider Project</button>
    </div>
  ),
}));

describe('SettingsPage', () => {
  const mockSettings = { language: 'en', theme: 'dark' } as SettingsData;
  const mockSaveSettings = vi.fn();
  const mockApi = {
    getProviders: vi.fn(() => Promise.resolve([])),
    updateProviders: vi.fn(() => Promise.resolve([])),
    getMcpServers: vi.fn(() => Promise.resolve({ global: {}, projectServers: {} })),
    replaceMcpServers: vi.fn(() => Promise.resolve({ global: {}, projectServers: {} })),
    setZoomLevel: vi.fn(),
    patchProjectSettings: vi.fn().mockResolvedValue({}),
    getProjectSettings: vi.fn().mockResolvedValue({}),
  };

  beforeEach(() => {
    mockSaveSettings.mockClear();
    mockApi.patchProjectSettings.mockClear();
    mockApi.getProjectSettings.mockReset().mockResolvedValue({});
    vi.mocked(showSuccessNotification).mockClear();
    vi.mocked(showErrorNotification).mockClear();
    vi.mocked(useSaveSettings).mockReturnValue(mockSaveSettings);
    vi.mocked(useSettingsStore).mockImplementation(((selector: (state: unknown) => unknown) =>
      selector({
        settings: mockSettings,
        theme: 'dark',
        font: 'Sono',
        fontSize: 14,
        setSettingsState: vi.fn(),
        setThemeValue: vi.fn(),
        setFontValue: vi.fn(),
        setFontSizeValue: vi.fn(),
      })) as never);

    vi.mocked(useAgents).mockReturnValue({
      profiles: [],
      loading: false,
      error: null,
      getProfiles: vi.fn(() => []),
      createProfile: vi.fn(),
      updateProfile: vi.fn(),
      deleteProfile: vi.fn(),
      refreshProfiles: vi.fn(),
      updateProfilesOrder: vi.fn(),
    });

    vi.mocked(useApi).mockReturnValue(mockApi as unknown as ApplicationAPI);
  });

  it('renders and loads providers', async () => {
    await act(async () => {
      render(<SettingsPage onClose={vi.fn()} />);
    });
    expect(screen.getByText('settings.title')).toBeInTheDocument();
    expect(mockApi.getProviders).toHaveBeenCalled();
  });

  it('closes the dialog immediately and saves in the background on Save', async () => {
    const onClose = vi.fn();
    await act(async () => {
      render(<SettingsPage onClose={onClose} />);
    });

    fireEvent.click(screen.getByText('Change Language'));

    // Save button should be enabled now
    const saveButton = screen.getByText('common.save');
    expect(saveButton).not.toBeDisabled();

    fireEvent.click(saveButton);

    // Dialog closes immediately, before the background save completes
    expect(onClose).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalledWith(expect.objectContaining({ language: 'zh' }));
    });

    await waitFor(() => {
      expect(showSuccessNotification).toHaveBeenCalledWith('settings.savedSuccessfully');
    });
  });

  it('shows an error notification when the background save fails', async () => {
    mockSaveSettings.mockRejectedValueOnce(new Error('boom'));
    const onClose = vi.fn();
    await act(async () => {
      render(<SettingsPage onClose={onClose} />);
    });

    fireEvent.click(screen.getByText('Change Language'));
    fireEvent.click(screen.getByText('common.save'));

    expect(onClose).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(showErrorNotification).toHaveBeenCalledWith('settings.saveError');
    });
    expect(showSuccessNotification).not.toHaveBeenCalled();
  });

  it('calls onClose when Cancel is clicked', async () => {
    const onClose = vi.fn();
    await act(async () => {
      render(<SettingsPage onClose={onClose} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('common.cancel'));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('saves only the changed project Aider overrides, including explicit null values', async () => {
    await act(async () => {
      render(
        <SettingsPage
          onClose={vi.fn()}
          openProjects={
            [
              { baseDir: '/project', settings: {} },
              { baseDir: '/other', settings: {} },
            ] as ProjectData[]
          }
        />,
      );
    });
    fireEvent.click(screen.getByText('Change Aider Project'));
    expect(screen.getByText('common.save')).not.toBeDisabled();
    fireEvent.click(screen.getByText('common.save'));
    await waitFor(() => expect(mockApi.patchProjectSettings).toHaveBeenCalledWith('/project', { aider: { mainModel: 'provider/model', weakModel: null } }));
    expect(mockApi.patchProjectSettings).toHaveBeenCalledTimes(1);
  });

  it('persists removal of the final project override as an empty object', async () => {
    mockApi.getProjectSettings.mockResolvedValue({ aider: { mainModel: 'provider/old' } });
    await act(async () => {
      render(<SettingsPage onClose={vi.fn()} openProjects={[{ baseDir: '/project', settings: { aider: { mainModel: 'provider/old' } } }] as ProjectData[]} />);
    });
    fireEvent.click(screen.getByText('Clear Aider Project'));
    fireEvent.click(screen.getByText('common.save'));
    await waitFor(() => expect(mockApi.patchProjectSettings).toHaveBeenCalledWith('/project', { aider: {} }));
  });

  it('discards project Aider edits when cancelled', async () => {
    await act(async () => {
      render(<SettingsPage onClose={vi.fn()} openProjects={[{ baseDir: '/project', settings: {} }] as ProjectData[]} />);
    });
    fireEvent.click(screen.getByText('Change Aider Project'));
    fireEvent.click(screen.getByText('common.cancel'));
    expect(mockApi.patchProjectSettings).not.toHaveBeenCalled();
  });
});
