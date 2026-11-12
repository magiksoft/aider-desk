import { spawn, spawnSync, type SpawnOptions } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { arch, platform } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Extension, ExtensionContext, SkillDefinition, ToolDefinition, ToolResult, UIComponentDefinition } from '../../extensions.d.ts';
import { z } from 'zod';

const __moduleDir = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__moduleDir, 'skills');
const SKILLS_REFRESH_SCRIPT = join(__moduleDir, 'scripts', 'fetch-skills.js');
const SKILLS_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const SKILLS_REFRESH_GUARD_MS = 3 * 60 * 1000;
const CLI_LOOKUP_TIMEOUT_MS = 10_000;
const RESOLUTION_RETRY_AFTER_MS = 60_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
const CLOSE_TIMEOUT_MS = 30_000;
const INSTALL_TIMEOUT_MS = 900_000;

const INSTALL_HINT =
  '\n\nHint: the browser does not seem to be installed yet. Call `agent_browser_execute` with {"args": ["install"]} to download Chrome for Testing (may take several minutes), then retry.';
const CLI_MISSING_MESSAGE =
  'The agent-browser CLI could not be found. Install it globally with `npm install -g agent-browser && agent-browser install`, or reinstall the Agent Browser extension so its bundled CLI is available.';

const SESSION_LEAVE_OUT_COMMANDS = new Set(['install', 'doctor', 'mcp', 'skills', 'upgrade']);

const isMuslLinux = platform() === 'linux' && (existsSync('/lib/ld-musl-x86_64.so.1') || existsSync('/lib/ld-musl-aarch64.so.1'));
const OS_KEY = platform() === 'linux' && isMuslLinux ? 'linux-musl' : platform();
const ARCH_KEY = platform() === 'win32' && arch() === 'arm64' ? 'x64' : arch();
const BINARY_NAME = `agent-browser-${OS_KEY}-${ARCH_KEY}${platform() === 'win32' ? '.exe' : ''}`;

type CliRunResult = { code: number; stdout: string; stderr: string };
type CliResolution = { binary: string | null; error: string | null };

let cachedCliResolution: CliResolution = { binary: null, error: null };
let nextCliLookupAt = 0;

const parseFrontMatterField = (markdown: string, field: string): string | null => {
  const frontMatter = /^---\n([\s\S]*?)\n---/.exec(markdown)?.[1];
  if (!frontMatter) {
    return null;
  }
  const match = new RegExp(`^${field}:[ \\t]*(.+)$`, 'm').exec(frontMatter)?.[1];
  return match ? match.trim() : null;
};

const getBundledPackageRoot = (): string | null => {
  try {
    const require = createRequire(join(__moduleDir, 'package.json'));
    return dirname(require.resolve('agent-browser/package.json'));
  } catch {
    return null;
  }
};

const probeGlobalCli = (): boolean => {
  try {
    const result = spawnSync('agent-browser', ['--version'], {
      encoding: 'utf-8',
      timeout: CLI_LOOKUP_TIMEOUT_MS,
      shell: platform() === 'win32',
    });
    return result.status === 0;
  } catch {
    return false;
  }
};

const resolveCliBinary = (): CliResolution => {
  if (cachedCliResolution.binary) {
    return cachedCliResolution;
  }
  if (Date.now() < nextCliLookupAt) {
    return cachedCliResolution;
  }

  const envBinary = process.env.AGENT_BROWSER_BIN?.trim();
  if (envBinary && existsSync(envBinary)) {
    cachedCliResolution = { binary: envBinary, error: null };
    return cachedCliResolution;
  }

  if (probeGlobalCli()) {
    cachedCliResolution = { binary: 'agent-browser', error: null };
    return cachedCliResolution;
  }

  const bundledRoot = getBundledPackageRoot();
  const bundledBinary = bundledRoot ? join(bundledRoot, 'bin', BINARY_NAME) : null;
  if (bundledBinary && existsSync(bundledBinary)) {
    cachedCliResolution = { binary: bundledBinary, error: null };
    return cachedCliResolution;
  }

  nextCliLookupAt = Date.now() + RESOLUTION_RETRY_AFTER_MS;
  cachedCliResolution = { binary: null, error: CLI_MISSING_MESSAGE };
  return cachedCliResolution;
};

const resetCliResolutionCache = (): void => {
  cachedCliResolution = { binary: null, error: null };
  nextCliLookupAt = 0;
};

const runCli = (binary: string, args: string[], timeoutMs: number, signal: AbortSignal | undefined): Promise<CliRunResult> =>
  new Promise((resolvePromise, reject) => {
    const spawnOptions: SpawnOptions = { stdio: ['ignore', 'pipe', 'pipe'], shell: platform() === 'win32' && !isAbsolute(binary) };

    const start = (retriesLeft: number) => {
      const child = spawn(binary, args, spawnOptions);
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
      const onAbort = () => child.kill('SIGTERM');
      signal?.addEventListener('abort', onAbort, { once: true });

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf-8');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8');
      });
      child.on('error', (error: NodeJS.ErrnoException) => {
        clearTimeout(timeout);
        if (error.code === 'EACCES' && retriesLeft > 0 && platform() !== 'win32') {
          try {
            chmodSync(binary, 0o755);
            start(0);
          } catch {
            reject(error);
          }
          return;
        }
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        resolvePromise({ code: code ?? -1, stdout, stderr });
      });
    };

    start(1);
  });

const cliResultToToolResult = (result: CliRunResult): ToolResult => {
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  if (result.code === 0) {
    return { content: [{ type: 'text', text: stdout || 'Command completed without output.' }] };
  }
  const message = stderr || stdout || `agent-browser command failed with exit code ${result.code}.`;
  const hint = /not installed|chrome for testing|could not find browser/i.test(message) ? INSTALL_HINT : '';
  return { content: [{ type: 'text', text: `${message}${hint}` }], isError: true };
};

const getTaskDir = (context: ExtensionContext): string =>
  (context.getTaskContext() as { getTaskDir?: () => string } | null)?.getTaskDir?.() || context.getProjectDir();

const getTaskDataDir = (context: ExtensionContext): string => {
  const taskContext = context.getTaskContext();
  if (typeof taskContext?.getTaskDataDir === 'function') {
    return taskContext.getTaskDataDir();
  }
  const taskId = taskContext?.data?.id;
  if (taskId) {
    return join(context.getProjectDir(), process.env.AIDER_DESK_DIR || '.aider-desk', 'tasks', taskId);
  }
  return getTaskDir(context);
};

const ensureDir = (dir: string): boolean => {
  try {
    mkdirSync(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
};

const resolveScreenshotPath = (taskDir: string, path: string): string => {
  const absolutePath = isAbsolute(path) ? path : join(taskDir, path);
  ensureDir(dirname(absolutePath));
  return absolutePath;
};

const defaultScreenshotPath = (context: ExtensionContext): string => {
  const absolutePath = join(getTaskDataDir(context), 'agent-browser-screenshots', `screenshot-${Date.now()}.png`);
  if (!ensureDir(dirname(absolutePath))) {
    return '';
  }
  return absolutePath;
};

const inferScreenshotMimeType = (filePath: string): string => {
  const extension = filePath.split('.').pop()?.toLowerCase() ?? '';
  if (extension === 'jpg' || extension === 'jpeg') {
    return 'image/jpeg';
  }
  if (extension === 'webp') {
    return 'image/webp';
  }
  return 'image/png';
};

const extractSavedScreenshotPath = (explicitPath: string | undefined, taskDir: string, cliResult: CliRunResult): string | null => {
  if (explicitPath) {
    return isAbsolute(explicitPath) ? explicitPath : join(taskDir, explicitPath);
  }
  const match = /((?:[A-Za-z]:[\\/]|\/)[^\r\n]+?\.(?:png|jpe?g|webp))/i.exec(cliResult.stdout);
  return match ? match[1] : null;
};

const attachScreenshotMedia = async (
  taskDir: string,
  input: z.infer<typeof screenshotSchema>,
  cliResult: CliRunResult,
): Promise<ToolResult> => {
  const baseResult = cliResultToToolResult(cliResult);
  if (baseResult.isError) {
    return baseResult;
  }
  const savedPath = extractSavedScreenshotPath(input.path, taskDir, cliResult);
  if (!savedPath || !existsSync(savedPath)) {
    return baseResult;
  }
  try {
    const data = await readFile(savedPath);
    const mimeType = inferScreenshotMimeType(savedPath);
    return {
      content: [
        { type: 'text', text: `Screenshot saved to ${savedPath}. The image is attached to this result and the next model request.` },
        {
          type: 'media' as const,
          data: data.toString('base64'),
          mimeType,
        } as unknown as ToolResult['content'][number],
      ],
    };
  } catch {
    return baseResult;
  }
};

const getSessionName = (context: ExtensionContext, explicit?: string): string => {
  if (explicit?.trim()) {
    return explicit.trim();
  }
  const projectName = context.getProjectDir().split(/[\\/]/).filter(Boolean).pop() ?? '';
  return projectName.replace(/[^A-Za-z0-9_-]/g, '-') || 'aiderdesk';
};

const buildSessionArgs = (context: ExtensionContext, args: string[], explicitSession?: string): string[] => {
  if (SESSION_LEAVE_OUT_COMMANDS.has(args[0] ?? '')) {
    return [...args];
  }
  return ['--session', getSessionName(context, explicitSession), ...args];
};

const readSessionInput = (input: Record<string, unknown>): string | undefined =>
  typeof input.session === 'string' && input.session.trim() ? input.session.trim() : undefined;

type CliResultTransform = (cliResult: CliRunResult) => ToolResult | Promise<ToolResult>;

const runToolCommand = async (
  context: ExtensionContext,
  args: string[],
  explicitSession: string | undefined,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  transformResult?: CliResultTransform,
): Promise<ToolResult> => {
  const resolution = resolveCliBinary();
  if (!resolution.binary) {
    return { content: [{ type: 'text', text: resolution.error ?? CLI_MISSING_MESSAGE }], isError: true };
  }
  try {
    const runArgs = buildSessionArgs(context, args, explicitSession);
    const cliResult = await runCli(resolution.binary, runArgs, timeoutMs, signal);
    return transformResult ? await transformResult(cliResult) : cliResultToToolResult(cliResult);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: [{ type: 'text', text: `Failed to run agent-browser: ${message}` }], isError: true };
  }
};

type ToolSchema = z.ZodType<Record<string, unknown>>;

const defineTool = <TSchema extends ToolSchema>(
  name: string,
  description: string,
  inputSchema: TSchema,
  buildArgs: (input: z.infer<TSchema>, context: ExtensionContext) => string[],
  timeoutMs: number = DEFAULT_COMMAND_TIMEOUT_MS,
  transformResult?: (input: z.infer<TSchema>, cliResult: CliRunResult) => ToolResult | Promise<ToolResult>,
): ToolDefinition<TSchema> => ({
  name,
  description,
  inputSchema,
  execute: (input, signal, context) => {
    const transform: CliResultTransform | undefined = transformResult
      ? (cliResult) => transformResult(input as z.infer<TSchema>, cliResult)
      : undefined;
    return runToolCommand(
      context,
      buildArgs(input as z.infer<TSchema>, context),
      readSessionInput(input as Record<string, unknown>),
      timeoutMs,
      signal,
      transform,
    );
  },
});

const sessionSchema = z
  .string()
  .optional()
  .describe('Optional agent-browser session name for an isolated separate browser. By default one session per AiderDesk project is used.');

const executeSchema = z.object({
  args: z
    .array(z.string())
    .min(1)
    .describe(
      'agent-browser CLI arguments, e.g. ["skills", "get", "core"], ["get", "text", "#price"], or ["eval", "document.title"]. Do not include the binary name, the --session flag, or other global flags.',
    ),
  session: sessionSchema,
});

const openSchema = z.object({
  url: z.string().describe('URL to open and navigate to (https:// is added automatically when missing).'),
  headed: z.boolean().optional().describe('Show the browser window on screen instead of running headless.'),
  session: sessionSchema,
});

const snapshotSchema = z.object({
  interactive: z.boolean().optional().describe('Only include interactive elements that can be clicked or filled (-i).'),
  compact: z.boolean().optional().describe('Remove empty structural elements from the tree (-c).'),
  depth: z.number().optional().describe('Limit accessibility tree depth (-d).'),
  selector: z.string().optional().describe('Scope the snapshot to a CSS selector (-s).'),
  session: sessionSchema,
});

const clickSchema = z.object({
  selector: z.string().describe('Element selector or a ref from the last snapshot (e.g. @e12) to click.'),
  session: sessionSchema,
});

const fillSchema = z.object({
  selector: z.string().describe('Input element selector or a ref from the last snapshot to clear and fill.'),
  text: z.string().describe('Value to enter into the element.'),
  session: sessionSchema,
});

const screenshotSchema = z.object({
  path: z
    .string()
    .optional()
    .describe(
      'File path for the screenshot, relative to the task working directory. When omitted, the screenshot is saved to agent-browser-screenshots/ in the task data directory (outside of the working tree).',
    ),
  fullPage: z.boolean().optional().describe('Capture the entire page instead of the viewport (--full).'),
  session: sessionSchema,
});

const closeSchema = z.object({
  session: sessionSchema,
});

const installSchema = z.object({
  withDeps: z.boolean().optional().describe('Also install Chromium system dependencies on Linux (--with-deps).'),
});

const readdirSafe = (dirPath: string) => {
  try {
    return readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
};

const loadSkillFromDir = (dirPath: string): SkillDefinition | null => {
  let markdown: string;
  try {
    markdown = readFileSync(join(dirPath, 'SKILL.md'), 'utf-8');
  } catch {
    return null;
  }
  let name = parseFrontMatterField(markdown, 'name') ?? basename(dirPath);
  if (!name.startsWith('agent-browser-')) {
    name = `agent-browser-${name}`;
  }
  const description = parseFrontMatterField(markdown, 'description') ?? 'agent-browser skill content';
  return { name, description, location: 'extension', dirPath };
};

const loadSkillsFromRoot = (rootDir: string): SkillDefinition[] => {
  const skills: SkillDefinition[] = [];
  for (const entry of readdirSafe(rootDir)) {
    if (!entry.isDirectory()) {
      continue;
    }
    const skill = loadSkillFromDir(join(rootDir, entry.name));
    if (skill) {
      skills.push(skill);
    }
  }
  return skills;
};

const getSkillSourceDirs = (): string[] => {
  const downloadedSkillDirs = readdirSafe(SKILLS_DIR)
    .filter((entry) => entry.isDirectory() && existsSync(join(SKILLS_DIR, entry.name, 'SKILL.md')))
    .map((entry) => join(SKILLS_DIR, entry.name));
  if (downloadedSkillDirs.length > 0) {
    return downloadedSkillDirs;
  }
  const bundledRoot = getBundledPackageRoot();
  if (!bundledRoot) {
    return [];
  }
  return readdirSafe(join(bundledRoot, 'skill-data'))
    .filter((entry) => entry.isDirectory() && existsSync(join(bundledRoot, 'skill-data', entry.name, 'SKILL.md')))
    .map((entry) => join(bundledRoot, 'skill-data', entry.name));
};

const metadata = {
  name: 'Agent Browser',
  version: '1.0.0',
  description:
    'Browser automation for agents via the agent-browser CLI: navigate, snapshot pages as accessibility trees with element refs, click, fill, screenshot, and run any CLI command. Uses a globally installed agent-browser when available, otherwise the CLI bundled with this extension, and ships version-fresh agent-browser skills.',
  author: 'wladimiiir',
  iconUrl: 'https://raw.githubusercontent.com/magiksoft/aider-desk/refs/heads/main/packages/extensions/extensions/agent-browser/icon.png',
  capabilities: ['tools', 'skills', 'multimodal', 'ui'],
};

export default class AgentBrowserExtension implements Extension {
  static metadata = metadata;

  private refreshInFlight = false;
  private lastSkillsRefreshCheckAt = 0;

  onLoad(context: ExtensionContext): void {
    this.maybeRefreshSkills(context);
  }

  onUnload(): void {
    resetCliResolutionCache();
  }

  getUIComponents(): UIComponentDefinition[] {
    const genericToolJsx = readFileSync(join(__moduleDir, 'AgentBrowserToolMessage.jsx'), 'utf-8');
    const screenshotJsx = readFileSync(join(__moduleDir, 'AgentBrowserScreenshotToolMessage.jsx'), 'utf-8');
    return [
      {
        id: 'agent-browser-screenshot-tool-message',
        placement: 'task-message',
        jsx: screenshotJsx,
        messageFilter: {
          types: ['tool'],
          serverName: 'extensions',
          toolName: 'agent_browser_screenshot',
        },
      },
      ...['agent_browser_open', 'agent_browser_snapshot', 'agent_browser_click', 'agent_browser_fill', 'agent_browser_close', 'agent_browser_execute', 'agent_browser_install'].map(
        (toolName): UIComponentDefinition => ({
          id: `agent-browser-${toolName.replace(/^agent_browser_/, '').replace(/_/g, '-')}-tool-message`,
          placement: 'task-message',
          jsx: genericToolJsx,
          messageFilter: {
            types: ['tool'],
            serverName: 'extensions',
            toolName,
          },
        }),
      ),
    ];
  }

  getTools(context: ExtensionContext): ToolDefinition[] {
    const taskDir = getTaskDir(context);

    return [
      defineTool(
        'agent_browser_execute',
        'Run any agent-browser CLI command and return its output. Use it for everything the dedicated browser tools do not cover: get info (get text/html/title/url/count), wait, eval, console/errors, cookies/storage, tab management, network inspection, auth, is <state> checks, and agent-browser skills commands. Typical browser workflow: open a URL, snapshot to get element refs, act on refs like @e12 with click/fill, take a new snapshot after navigation or DOM changes, and close the browser when done. The full command reference lives in the agent-browser-core skill.',
        executeSchema,
        (input) => input.args,
      ),
      defineTool(
        'agent_browser_open',
        'Launch the agent-browser-managed browser (headless by default, Chrome for Testing via CDP) and optionally navigate to a URL. Use this before snapshotting a page.',
        openSchema,
        (input) => ['open', input.url, ...(input.headed ? ['--headed'] : [])],
      ),
      defineTool(
        'agent_browser_snapshot',
        'Take an accessibility-tree snapshot of the current page. Each element gets a ref you can pass to agent_browser_click or agent_browser_fill. Refs describe the page at snapshot time; take a new snapshot after navigation or DOM changes before using refs again.',
        snapshotSchema,
        (input) => {
          const args = ['snapshot'];
          if (input.interactive) {
            args.push('-i');
          }
          if (input.compact) {
            args.push('-c');
          }
          if (typeof input.depth === 'number') {
            args.push('-d', String(input.depth));
          }
          if (input.selector) {
            args.push('-s', input.selector);
          }
          return args;
        },
      ),
      defineTool(
        'agent_browser_click',
        'Click an element by a ref from the last agent_browser_snapshot (e.g. @e12) or by CSS/text/semantic selector or XPath. The click fails instead of succeeding when the target is hidden, disabled, outside of the viewport, or covered by another element such as a consent banner; on failure, dismiss the covering element, take a new snapshot, and retry.',
        clickSchema,
        (input) => ['click', input.selector],
      ),
      defineTool(
        'agent_browser_fill',
        'Clear an input element (by a ref from the last agent_browser_snapshot or by selector) and type new text into it.',
        fillSchema,
        (input) => ['fill', input.selector, input.text],
      ),
      defineTool(
        'agent_browser_screenshot',
        'Capture a screenshot of the current page state and return both the saved file path and the image itself (attached to the task as multimodal media), so no separate file read is needed. Use it to visually verify page state that a plain snapshot cannot capture.',
        screenshotSchema,
        (input) => {
          const args = ['screenshot'];
          const outputPath = input.path ? resolveScreenshotPath(taskDir, input.path) : defaultScreenshotPath(context);
          if (outputPath) {
            args.push(outputPath);
          }
          if (input.fullPage) {
            args.push('--full');
          }
          return args;
        },
        DEFAULT_COMMAND_TIMEOUT_MS,
        (input, cliResult) => attachScreenshotMedia(taskDir, input, cliResult),
      ),
      defineTool(
        'agent_browser_close',
        'Close the browser managed for the current session, releasing its background daemon.',
        closeSchema,
        () => ['close'],
        CLOSE_TIMEOUT_MS,
      ),
      defineTool(
        'agent_browser_install',
        'One-time download of the Chrome for Testing browser binary used by all other agent_browser tools (roughly 150 MB download; may take several minutes). Needed only when other tools report the browser as not installed.',
        installSchema,
        (input) => ['install', ...(input.withDeps ? ['--with-deps'] : [])],
        INSTALL_TIMEOUT_MS,
      ),
    ];
  }

  getSkills(context: ExtensionContext): SkillDefinition[] {
    this.maybeRefreshSkills(context);
    const downloadedSkills = loadSkillsFromRoot(SKILLS_DIR);
    if (downloadedSkills.length > 0) {
      return downloadedSkills;
    }
    return getSkillSourceDirs()
      .map((dirPath) => loadSkillFromDir(dirPath))
      .filter((skill): skill is SkillDefinition => skill !== null);
  }

  private maybeRefreshSkills(context: ExtensionContext): void {
    if (this.refreshInFlight || Date.now() - this.lastSkillsRefreshCheckAt < SKILLS_REFRESH_GUARD_MS) {
      return;
    }
    this.lastSkillsRefreshCheckAt = Date.now();

    let refreshNeeded = true;
    try {
      const meta = JSON.parse(readFileSync(join(SKILLS_DIR, '.refreshed-at.json'), 'utf-8')) as { refreshedAt?: string };
      const refreshedAtMs = meta.refreshedAt ? new Date(meta.refreshedAt).getTime() : 0;
      if (Number.isFinite(refreshedAtMs) && Date.now() - refreshedAtMs < SKILLS_STALE_AFTER_MS) {
        refreshNeeded = false;
      }
    } catch {
      // No refresh metadata: refresh below.
    }
    if (!refreshNeeded) {
      return;
    }

    this.refreshInFlight = true;
    const guard = setTimeout(() => {
      this.refreshInFlight = false;
    }, SKILLS_REFRESH_GUARD_MS);
    guard.unref();

    try {
      const child = spawn(process.execPath, [SKILLS_REFRESH_SCRIPT], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: 'ignore',
        detached: true,
      });
      child.on('error', (error) => {
        this.refreshInFlight = false;
        context.log(`Failed to refresh agent-browser skills: ${error instanceof Error ? error.message : String(error)}`, 'warn');
      });
      child.on('exit', () => {
        this.refreshInFlight = false;
      });
      child.unref();
    } catch (error) {
      this.refreshInFlight = false;
      context.log(`Failed to start agent-browser skills refresh: ${error instanceof Error ? error.message : String(error)}`, 'warn');
    }
  }
}
