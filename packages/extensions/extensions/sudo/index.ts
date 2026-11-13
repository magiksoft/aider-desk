import { mkdtemp, chmod, writeFile, rm } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { OS, type BashExecutionEvent, type CommandDefinition, type Extension, type ExtensionContext, type ToolFinishedEvent } from '@aiderdesk/extensions';

const extensionDir = dirname(fileURLToPath(import.meta.url));
const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

export default class SudoExtension implements Extension {
  static metadata = {
    name: 'Sudo',
    version: '1.0.0',
    description: 'Password dialog and optional session remembering for sudo in Power bash (Linux)',
    author: 'wladimiiir',
    iconUrl: 'https://raw.githubusercontent.com/magiksoft/aider-desk/refs/heads/main/packages/extensions/extensions/sudo/icon.png',
    capabilities: ['commands', 'security'],
    supportedOS: [OS.Linux],
  };

  private passwords = new Map<string, string>();
  private executions = new Set<AbortController>();

  async onLoad(context: ExtensionContext): Promise<void> {
    context.addDisposable(() => () => {
      this.passwords.clear();
      for (const execution of this.executions) execution.abort();
      this.executions.clear();
    });
  }

  getCommands(): CommandDefinition[] {
    return [
      {
        name: 'sudo-forget',
        description: 'Forget sudo passwords remembered by this extension',
        execute: async () => {
          this.passwords.clear();
        },
      },
    ];
  }

  async onToolFinished(event: ToolFinishedEvent, context: ExtensionContext): Promise<void> {
    if (event.toolName !== 'power---bash' || !event.output || typeof event.output !== 'object') return;
    const output = event.output as { exitCode?: unknown };
    if (typeof output.exitCode === 'number' && output.exitCode !== 0) {
      const prefix = `${context.getProjectDir()}\0`;
      for (const key of this.passwords.keys()) {
        if (key.startsWith(prefix)) this.passwords.delete(key);
      }
    }
  }

  async onBashExecution(event: BashExecutionEvent, context: ExtensionContext): Promise<Partial<BashExecutionEvent> | void> {
    if (process.platform !== 'linux' || !/\bsudo\b/.test(event.command)) return;
    const shell = basename(event.shell);
    if (!['bash', 'sh', 'dash', 'zsh', 'fish'].includes(shell)) {
      throw new Error('Sudo extension does not support this shell.');
    }
    const controller = new AbortController();
    const signal = event.abortSignal ? AbortSignal.any([controller.signal, event.abortSignal]) : controller.signal;
    const dir = await mkdtemp(join(tmpdir(), 'ad-sudo-'));
    this.executions.add(controller);
    const socketPath = join(dir, 's');
    const sockets = new Set<Socket>();
    const server = createServer();
    let active = false;
    const attempts = new Set<string>();
    const cleanup = async () => {
      controller.abort();
      this.executions.delete(controller);
      for (const socket of sockets) socket.destroy();
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    };
    event.addCleanup(cleanup);
    signal.addEventListener(
      'abort',
      () => {
        for (const socket of sockets) socket.destroy();
      },
      { once: true },
    );
    await chmod(dir, 0o700);
    await writeFile(
      join(dir, 'askpass'),
      `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${quote(process.execPath)} ${quote(join(extensionDir, 'askpass.cjs'))} "$@"\n`,
      { mode: 0o700 },
    );
    await writeFile(join(dir, 'sudo'), '#!/bin/sh\nexec /usr/bin/sudo -A "$@"\n', { mode: 0o700 });
    server.on('connection', (socket) => {
      if (signal.aborted || active) {
        socket.destroy();
        return;
      }
      active = true;
      const disconnected = new AbortController();
      const requestSignal = AbortSignal.any([signal, disconnected.signal]);
      sockets.add(socket);
      socket.setEncoding('utf8');
      socket.setTimeout(180_000, () => socket.destroy());
      let request = '';
      let handled = false;
      socket.on('close', () => {
        disconnected.abort();
        sockets.delete(socket);
        active = false;
      });
      socket.on('error', () => {});
      socket.on('data', async (data: string) => {
        if (handled) return;
        request += data;
        if (request.length > 8192) {
          socket.destroy();
          return;
        }
        if (!request.includes('\n')) return;
        handled = true;
        try {
          const parsed = JSON.parse(request.trim()) as { prompt?: unknown; pid?: unknown };
          if (typeof parsed.prompt !== 'string' || typeof parsed.pid !== 'number' || !Number.isSafeInteger(parsed.pid) || parsed.pid <= 0) {
            socket.destroy();
            return;
          }
          const key = `${context.getProjectDir()}\0${parsed.prompt}`;
          const attempt = `${parsed.pid}\0${parsed.prompt}`;
          // Only repeated requests from the same sudo process indicate a rejected credential.
          if (attempts.has(attempt)) this.passwords.delete(key);
          attempts.add(attempt);
          let password = this.passwords.get(key);
          if (password === undefined) {
            const response = await context.requestInput(
              {
                title: 'Administrator password',
                message: `Sudo requests authentication.

Command: {{command}}
Working directory: {{cwd}}

{{prompt}}`,
                messageParams: {
                  command: event.command,
                  cwd: event.cwd,
                  prompt: parsed.prompt,
                },
                type: 'password',
                allowRememberSession: true,
                rememberSessionLabel: 'Remember until AiderDesk closes',
                confirmLabel: 'Use password',
              },
              requestSignal,
            );
            if (response.value === null || signal.aborted || socket.destroyed) {
              controller.abort();
              return;
            }
            password = response.value;
            if (response.rememberSession) this.passwords.set(key, password);
          }
          if (!signal.aborted && !socket.destroyed) socket.end(JSON.stringify({ password }));
        } catch {
          socket.destroy();
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    server.on('error', () => controller.abort());
    await chmod(socketPath, 0o600);
    return {
      commandPrefix: shell === 'fish' ? `set -gx PATH ${quote(dir)} $PATH;` : `export PATH=${quote(dir)}:"$PATH";`,
      env: {
        ...event.env,
        PATH: `${dir}:${event.env.PATH || '/usr/bin:/bin'}`,
        SUDO_ASKPASS: join(dir, 'askpass'),
        AIDERDESK_SUDO_SOCKET: socketPath,
      },
    };
  }
}
