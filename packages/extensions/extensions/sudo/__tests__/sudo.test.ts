import { execFile } from 'node:child_process';
import { access, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SudoExtension from '../index';

import type { BashExecutionEvent, ExtensionContext, ExtensionInputResponse } from '@aiderdesk/extensions';

const execFileAsync = promisify(execFile);
const cleanups: (() => void | Promise<void>)[] = [];
const requestInput = vi.fn<(prompt: unknown, signal?: AbortSignal) => Promise<ExtensionInputResponse>>();
let project = '/project';
let unload: (() => void | Promise<void>) | undefined;
const context = {
  requestInput,
  getProjectDir: () => project,
  addDisposable: (setup: () => (() => void | Promise<void>) | void) => {
    unload = setup() || undefined;
  },
} as unknown as ExtensionContext;

const configure = async (extension: SudoExtension, command = 'sudo id', signal?: AbortSignal) => {
  const event: BashExecutionEvent = {
    toolCallId: 'test',
    command,
    cwd: project,
    shell: '/bin/bash',
    abortSignal: signal,
    env: { PATH: process.env.PATH },
    addCleanup: (cleanup) => {
      cleanups.push(cleanup);
    },
  };
  return extension.onBashExecution(event, context);
};

const ask = (env: Record<string, string | undefined>, prompt = '[sudo] password for tester:') =>
  execFileAsync(env.SUDO_ASKPASS!, [prompt], { env: { ...process.env, ...env } });

beforeEach(() => {
  requestInput.mockReset();
  requestInput.mockResolvedValue({ value: 'private-password', rememberSession: false });
  project = '/project';
  unload = undefined;
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  await unload?.();
});

describe.skipIf(process.platform !== 'linux')('sudo askpass integration without privilege elevation', () => {
  it('supplies a password only through helper stdout, with owner-only resources', async () => {
    const extension = new SudoExtension();
    const execution = await configure(extension);
    const env = execution!.env!;
    expect(JSON.stringify(execution)).not.toContain('private-password');
    expect((await stat(dirname(env.SUDO_ASKPASS!))).mode & 0o777).toBe(0o700);
    expect((await stat(env.AIDERDESK_SUDO_SOCKET!)).mode & 0o777).toBe(0o600);
    expect(await readFile(join(dirname(env.SUDO_ASKPASS!), 'sudo'), 'utf8')).toContain('/usr/bin/sudo -A "$@"');
    const output = await ask(env);
    expect(output).toEqual({ stdout: 'private-password\n', stderr: '' });
    expect(requestInput).toHaveBeenCalledOnce();
    expect(requestInput.mock.calls[0][0]).toMatchObject({
      title: 'Administrator password',
      type: 'password',
      message: expect.stringContaining('Sudo requests authentication.'),
      messageParams: { command: 'sudo id', cwd: '/project' },
      rememberSessionLabel: 'Remember until AiderDesk closes',
      confirmLabel: 'Use password',
    });
    for (const cleanup of cleanups.splice(0)) await cleanup();
    await expect(access(env.SUDO_ASKPASS!)).rejects.toThrow();
    await expect(access(env.AIDERDESK_SUDO_SOCKET!)).rejects.toThrow();
  });

  it('does not prompt if no sudo authentication is requested', async () => {
    const extension = new SudoExtension();
    expect(await configure(extension, 'echo hello')).toBeUndefined();
    await configure(extension, 'echo "sudo is installed"');
    expect(requestInput).not.toHaveBeenCalled();
  });

  it('does not retain use-once passwords between executions', async () => {
    const extension = new SudoExtension();
    await ask((await configure(extension))!.env!);
    await ask((await configure(extension))!.env!);
    expect(requestInput).toHaveBeenCalledTimes(2);
  });

  it('remembers by project and authentication prompt, and supports forgetting', async () => {
    const extension = new SudoExtension();
    requestInput.mockResolvedValue({ value: 'remembered', rememberSession: true });
    await ask((await configure(extension))!.env!);
    await ask((await configure(extension))!.env!);
    expect(requestInput).toHaveBeenCalledOnce();
    project = '/another-project';
    await ask((await configure(extension))!.env!);
    expect(requestInput).toHaveBeenCalledTimes(2);
    await extension.getCommands()[0].execute([], context);
    await ask((await configure(extension))!.env!);
    expect(requestInput).toHaveBeenCalledTimes(3);
  });

  it('discards a rejected credential on repeated authentication', async () => {
    const extension = new SudoExtension();
    requestInput.mockResolvedValue({ value: 'bad-password', rememberSession: true });
    const env = (await configure(extension))!.env!;
    await ask(env);
    requestInput.mockResolvedValue({ value: 'corrected', rememberSession: false });
    expect((await ask(env)).stdout).toBe('corrected\n');
    expect(requestInput).toHaveBeenCalledTimes(2);
  });

  it('clears cached credentials after a failed bash command', async () => {
    const extension = new SudoExtension();
    requestInput.mockResolvedValue({ value: 'remembered', rememberSession: true });
    await ask((await configure(extension))!.env!);
    await extension.onToolFinished(
      {
        toolName: 'power---bash',
        toolCallId: 'test',
        agentProfile: {} as never,
        input: { command: 'sudo id' },
        output: { exitCode: 1 },
      },
      context,
    );
    await ask((await configure(extension))!.env!);
    expect(requestInput).toHaveBeenCalledTimes(2);
  });

  it('revokes askpass when the command signal is cancelled', async () => {
    const extension = new SudoExtension();
    const controller = new AbortController();
    const env = (await configure(extension, 'sudo id', controller.signal))!.env!;
    controller.abort();
    await expect(ask(env)).rejects.toMatchObject({ stdout: '' });
    expect(requestInput).not.toHaveBeenCalled();
  });

  it('cancels authentication without exposing a password', async () => {
    const extension = new SudoExtension();
    requestInput.mockResolvedValue({ value: null, rememberSession: false });
    await expect(ask((await configure(extension))!.env!)).rejects.toMatchObject({ stdout: '', stderr: '' });
  });

  it('aborts pending input and revokes the helper on extension unload', async () => {
    const extension = new SudoExtension();
    await extension.onLoad(context);
    let signal: AbortSignal | undefined;
    requestInput.mockImplementation(async (_prompt, inputSignal) => {
      signal = inputSignal;
      return new Promise((resolve) => inputSignal!.addEventListener('abort', () => resolve({ value: null, rememberSession: false }), { once: true }));
    });
    const env = (await configure(extension))!.env!;
    const result = ask(env);
    const assertion = expect(result).rejects.toMatchObject({ stdout: '' });
    await vi.waitFor(() => expect(requestInput).toHaveBeenCalledOnce());
    await unload?.();
    expect(signal?.aborted).toBe(true);
    await assertion;
  });
});
