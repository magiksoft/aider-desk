import { describe, expect, it, vi } from 'vitest';
import { Socket } from 'socket.io';

import { EventManager } from '@/events';

vi.mock('@/logger');

describe('readonly event subscriptions', () => {
  it('only emits selected events for the subscribed project', () => {
    const eventManager = new EventManager();
    const emit = vi.fn();
    const socket = { id: 'readonly-client', emit } as unknown as Socket;

    eventManager.subscribe(socket, {
      readonly: true,
      eventTypes: ['user-message'],
      baseDirs: ['/projects/public'],
    });

    eventManager.sendUserMessage({
      type: 'user',
      id: 'message-1',
      baseDir: '/projects/private',
      taskId: 'task-1',
      content: 'private',
    });
    eventManager.sendUserMessage({
      type: 'user',
      id: 'message-2',
      baseDir: '/projects/public',
      taskId: 'task-1',
      content: 'public',
    });
    eventManager.sendContextFilesUpdated('/projects/public', 'task-1', []);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('event', {
      type: 'user-message',
      data: expect.objectContaining({ id: 'message-2', baseDir: '/projects/public' }),
    });
  });
});

describe('task-state invalidation subscriptions', () => {
  it.each([false, true])('delivers metadata-free global refreshes to scoped clients (readonly=%s)', (readonly) => {
    const manager = new EventManager();
    const publicEmit = vi.fn();
    const privateEmit = vi.fn();
    manager.subscribe({ id: 'public', emit: publicEmit } as unknown as Socket, {
      readonly,
      eventTypes: ['extension-ui-refresh'],
      baseDirs: ['/projects/public'],
    });
    manager.subscribe({ id: 'private', emit: privateEmit } as unknown as Socket, {
      readonly,
      eventTypes: ['extension-ui-refresh'],
      baseDirs: ['/projects/private'],
    });

    manager.sendExtensionUIRefresh({ projectDir: undefined, reloadTaskStates: true });

    for (const emit of [publicEmit, privateEmit]) {
      expect(emit).toHaveBeenCalledExactlyOnceWith('event', {
        type: 'extension-ui-refresh',
        data: { reloadTaskStates: true },
      });
    }
  });

  it('still respects event-type filters for global invalidations', () => {
    const manager = new EventManager();
    const emit = vi.fn();
    manager.subscribe({ id: 'other-event', emit } as unknown as Socket, {
      readonly: true,
      eventTypes: ['user-message'],
      baseDirs: ['/projects/public'],
    });
    manager.sendExtensionUIRefresh({ reloadTaskStates: true });
    expect(emit).not.toHaveBeenCalled();
  });

  it('still confines project-scoped refreshes to their project', () => {
    const manager = new EventManager();
    const emit = vi.fn();
    manager.subscribe({ id: 'scoped', emit } as unknown as Socket, {
      readonly: true,
      eventTypes: ['extension-ui-refresh'],
      baseDirs: ['/projects/public'],
    });
    manager.sendExtensionUIRefresh({ projectDir: '/projects/private', reloadTaskStates: true });
    expect(emit).not.toHaveBeenCalled();
    manager.sendExtensionUIRefresh({ projectDir: '/projects/public', reloadTaskStates: true });
    expect(emit).toHaveBeenCalledExactlyOnceWith('event', {
      type: 'extension-ui-refresh',
      data: { projectDir: '/projects/public', reloadTaskStates: true },
    });
  });

  it.each([
    { extensionId: 'private-extension' },
    { componentId: 'private-component' },
    { taskId: 'private-task' },
    { reloadComponents: true },
    { reloadComponents: false },
    { projectDir: '' },
  ])('does not let mixed global refresh payloads bypass project filters (%j)', (metadata) => {
    const manager = new EventManager();
    const emit = vi.fn();
    manager.subscribe({ id: 'scoped', emit } as unknown as Socket, {
      readonly: true,
      eventTypes: ['extension-ui-refresh'],
      baseDirs: ['/projects/public'],
    });
    manager.sendExtensionUIRefresh({ reloadTaskStates: true, ...metadata });
    expect(emit).not.toHaveBeenCalled();
  });

  it('does not bypass project filters for other directory-less extension events', () => {
    const manager = new EventManager();
    const emit = vi.fn();
    manager.subscribe({ id: 'scoped', emit } as unknown as Socket, {
      readonly: true,
      eventTypes: ['extension-ui-refresh', 'extensions-updated'],
      baseDirs: ['/projects/public'],
    });
    manager.sendExtensionUIRefresh({ reloadComponents: true });
    manager.sendExtensionUIRefresh({ reloadTaskStates: false });
    manager.sendExtensionsUpdated();
    expect(emit).not.toHaveBeenCalled();
  });
});
