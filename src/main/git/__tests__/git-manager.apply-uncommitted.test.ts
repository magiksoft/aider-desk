import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { GitManager } from '../git-manager';

import { execWithShellPath } from '@/utils';

vi.mock('@/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/utils', async () => {
  const { withLock } = await import('@/utils/mutex');
  return {
    execWithShellPath: vi.fn(),
    withLock,
  };
});

const OK = { stdout: '', stderr: '' };

type SimulatorOptions = {
  statusByCwd?: Record<string, string>;
  currentBranch?: string;
  failApply?: (cwd: string | undefined, stashId: string) => string | null;
  failPush?: (cwd: string | undefined) => string | null;
};

/**
 * Installs a minimal git command simulator on the mocked execWithShellPath that emulates the
 * stash workflow (push/list/apply/drop) plus status/branch/reset, and records the operations
 * it performed so tests can assert on their order.
 */
const installGitSimulator = (options: SimulatorOptions = {}) => {
  const events: string[] = [];
  const stashStore: string[] = [];

  (execWithShellPath as Mock).mockImplementation(async (command: string, opts?: { cwd?: string }) => {
    const cwd = opts?.cwd ?? '';

    if (command.startsWith('git stash push')) {
      const match = command.match(/-m "([^"]+)"/);
      const stashId = match![1].split(':')[0];
      const failureOutput = options.failPush?.(cwd);
      if (failureOutput) {
        events.push(`push-failed:${cwd}:${stashId}`);
        throw new Error(failureOutput);
      }
      events.push(`push:${cwd}:${stashId}`);
      stashStore.push(match![1]);
      return OK;
    }
    if (command === 'git stash list') {
      const lines = stashStore.map((message, index) => `stash@{${stashStore.length - 1 - index}}: ${message}`);
      return { stdout: lines.join('\n'), stderr: '' };
    }
    if (command.startsWith('git stash apply')) {
      const ref = command.replace('git stash apply', '').trim();
      const index = Number(ref.slice(7, -1));
      const stashId = stashStore[stashStore.length - 1 - index].split(':')[0];
      events.push(`apply:${cwd}:${stashId}`);
      const failureOutput = options.failApply?.(cwd, stashId);
      if (failureOutput) {
        throw new Error(failureOutput);
      }
      return OK;
    }
    if (command.startsWith('git stash drop')) {
      const ref = command.replace('git stash drop', '').trim();
      const index = Number(ref.slice(7, -1));
      const stashId = stashStore[stashStore.length - 1 - index].split(':')[0];
      events.push(`drop:${cwd}:${stashId}`);
      stashStore.splice(stashStore.length - 1 - index, 1);
      return OK;
    }
    if (command.startsWith('git status')) {
      return { stdout: options.statusByCwd?.[cwd] ?? '', stderr: '' };
    }
    if (command === 'git branch --show-current') {
      return { stdout: `${options.currentBranch ?? 'main'}\n`, stderr: '' };
    }
    if (command === 'git reset --hard') {
      events.push(`reset:${cwd}`);
      return OK;
    }
    return OK;
  });

  return { events, stashStore };
};

describe('GitManager - applyUncommittedChangesToMain', () => {
  let gitManager: GitManager;
  const projectPath = '/test/project';
  const worktreePath = '/test/project/.aider-desk/worktrees/task-1';
  const taskId = 'task-1';

  beforeEach(() => {
    vi.clearAllMocks();
    gitManager = new GitManager();
  });

  it('applies worktree changes, restores project changes and drops the stashes last', async () => {
    const { events } = installGitSimulator({
      statusByCwd: { [worktreePath]: '?? notes.txt', [projectPath]: ' M local.txt' },
    });

    await gitManager.applyUncommittedChangesToMain(projectPath, taskId, worktreePath);

    expect(events[0]).toMatch(new RegExp(`^push:${worktreePath}:worktree-${taskId}-uncommitted-`));
    expect(events[1]).toMatch(new RegExp(`^push:${projectPath}:main-${taskId}-uncommitted-`));
    const worktreeStashId = events[0].split(':')[2];
    const projectStashId = events[1].split(':')[2];

    expect(events.slice(2)).toEqual([
      `apply:${projectPath}:${worktreeStashId}`,
      `apply:${worktreePath}:${worktreeStashId}`,
      `apply:${projectPath}:${projectStashId}`,
      `drop:${projectPath}:${projectStashId}`,
      `drop:${worktreePath}:${worktreeStashId}`,
    ]);
  });

  it('fully rolls back both change sets when applying the worktree stash to the project conflicts', async () => {
    const { events, stashStore } = installGitSimulator({
      statusByCwd: { [worktreePath]: '?? notes.txt', [projectPath]: ' M local.txt' },
      failApply: (cwd, stashId) => (cwd === projectPath && stashId.startsWith('worktree-') ? 'CONFLICT (content): Merge conflict in file.txt' : null),
    });

    await expect(gitManager.applyUncommittedChangesToMain(projectPath, taskId, worktreePath)).rejects.toThrow(
      /Failed to apply uncommitted changes: .*Failed to apply stash with conflicts/,
    );

    expect(events[0]).toMatch(/^push:.*:worktree-/);
    expect(events[1]).toMatch(/^push:.*:main-/);
    const worktreeStashId = events[0].split(':')[2];
    const projectStashId = events[1].split(':')[2];

    expect(events.slice(2)).toEqual([
      `apply:${projectPath}:${worktreeStashId}`,
      `reset:${projectPath}`,
      `reset:${worktreePath}`,
      `apply:${projectPath}:${projectStashId}`,
      `drop:${projectPath}:${projectStashId}`,
      `apply:${worktreePath}:${worktreeStashId}`,
      `drop:${worktreePath}:${worktreeStashId}`,
    ]);
    expect(stashStore).toEqual([]);
  });

  it('keeps the project stash and reports it when the original project changes cannot be restored', async () => {
    const { events, stashStore } = installGitSimulator({
      statusByCwd: { [worktreePath]: '?? notes.txt', [projectPath]: ' M local.txt' },
      failApply: (cwd, stashId) =>
        cwd === projectPath && stashId.startsWith('main-') ? 'error: Your local changes to the following files would be overwritten by merge' : null,
    });

    await expect(gitManager.applyUncommittedChangesToMain(projectPath, taskId, worktreePath)).rejects.toThrow(
      new RegExp(`preserved in stash 'main-${taskId}-uncommitted-[^']*' and can be restored manually`),
    );

    expect(events[0]).toMatch(/^push:.*:worktree-/);
    expect(events[1]).toMatch(/^push:.*:main-/);
    const worktreeStashId = events[0].split(':')[2];
    const projectStashId = events[1].split(':')[2];

    expect(events.slice(2)).toEqual([
      `apply:${projectPath}:${worktreeStashId}`,
      `apply:${worktreePath}:${worktreeStashId}`,
      `apply:${projectPath}:${projectStashId}`,
      `reset:${projectPath}`,
      `reset:${worktreePath}`,
      `apply:${projectPath}:${projectStashId}`,
      `apply:${worktreePath}:${worktreeStashId}`,
      `drop:${worktreePath}:${worktreeStashId}`,
    ]);
    expect(stashStore).toHaveLength(1);
    expect(stashStore[0].startsWith(`main-${taskId}-uncommitted-`)).toBe(true);
  });

  it('does not touch the worktree during recovery when the initial worktree stash push fails', async () => {
    const { events, stashStore } = installGitSimulator({
      statusByCwd: { [worktreePath]: '?? notes.txt', [projectPath]: ' M local.txt' },
      failPush: (cwd) => (cwd === worktreePath ? 'error: cannot stash' : null),
    });

    await expect(gitManager.applyUncommittedChangesToMain(projectPath, taskId, worktreePath)).rejects.toThrow(
      /Failed to apply uncommitted changes: .*Failed to stash uncommitted changes/,
    );

    expect(events[0]).toMatch(new RegExp(`^push-failed:${worktreePath}:worktree-${taskId}-uncommitted-`));
    // The project directory may still be reset (it was never stashed either), but the worktree
    // must not be touched since its changes were never actually stashed away.
    expect(events.some((event) => event.startsWith(`reset:${worktreePath}`))).toBe(false);
    expect(stashStore).toEqual([]);
  });

  it('does nothing when the worktree has no uncommitted changes', async () => {
    const { events } = installGitSimulator();

    await gitManager.applyUncommittedChangesToMain(projectPath, taskId, worktreePath);

    expect(events).toEqual([]);
  });
});

describe('GitManager - git mutation locking', () => {
  let gitManager: GitManager;

  beforeEach(() => {
    vi.clearAllMocks();
    gitManager = new GitManager();
  });

  it('serializes checkout, merge and rebase mutations on the same repository', async () => {
    let active = 0;
    let maxActive = 0;

    (execWithShellPath as Mock).mockImplementation(async (command: string) => {
      if (/^git (checkout|merge|rebase) /.test(command)) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
      }
      return OK;
    });

    await Promise.all([
      gitManager.checkoutBranch('/repo/one', 'feature-a'),
      gitManager.mergeIntoCurrent('/repo/one', 'feature-b'),
      gitManager.rebaseOnto('/repo/one', 'main'),
    ]);

    expect(maxActive).toBe(1);
  });

  it('allows concurrent mutations on different repositories', async () => {
    let active = 0;
    let maxActive = 0;

    (execWithShellPath as Mock).mockImplementation(async (command: string) => {
      if (/^git (checkout|merge|rebase) /.test(command)) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
      }
      return OK;
    });

    await Promise.all([gitManager.checkoutBranch('/repo/one', 'feature-a'), gitManager.checkoutBranch('/repo/two', 'feature-b')]);

    expect(maxActive).toBe(2);
  });
});
