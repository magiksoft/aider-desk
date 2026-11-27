/**
 * Tests for extension module hooks: natively imported helper modules (.mjs, .cjs,
 * plain .js) must be re-executed when an extension is reloaded, while modules
 * outside the extension scope (shared dependencies) keep their identity.
 *
 * Regression tests for https://github.com/magiksoft/aider-desk/issues/1016:
 * imported .mjs helpers stayed cached after an extension was edited and reloaded.
 */

import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { ExtensionLoader } from '../extension-loader';
import { deregisterExtensionResolveHooks } from '../extension-module-hooks';

vi.mock('@/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

const METADATA = 'static metadata = { name: "cache-test", version: "1.0.0" };';

describe('Extension module hooks', () => {
  let rootDir: string;
  let loader: ExtensionLoader;

  const writeExtension = async (name: string, files: Record<string, string>): Promise<string> => {
    const dir = path.join(rootDir, name);
    await fs.mkdir(dir, { recursive: true });
    for (const [file, content] of Object.entries(files)) {
      await fs.writeFile(path.join(dir, file), content);
    }
    return path.join(dir, 'index.ts');
  };

  const loadAndGetInfo = async (entryPath: string, { invalidate = true } = {}): Promise<Record<string, unknown>> => {
    if (invalidate) {
      loader.invalidateExtensionModules(entryPath);
    }
    const module = (await loader.loadExtension(entryPath)) as unknown as {
      extension: { getInfo: () => Record<string, unknown> };
    };
    return module.extension.getInfo();
  };

  beforeEach(() => {
    loader = new ExtensionLoader();
  });

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aider-desk-ext-hooks-'));
  });

  afterEach(async () => {
    deregisterExtensionResolveHooks();
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('reloads an edited .mjs helper imported by the extension entry (issue #1016)', async () => {
    const entryPath = await writeExtension('zz-repro-cache', {
      'helper.mjs': "export const HELPER_VERSION = 'helper-v1';",
      'index.ts': [
        "import { HELPER_VERSION, helperHello } from './helper.mjs';",
        'export default class Ext {',
        `  ${METADATA}`,
        '  getInfo() { return { version: HELPER_VERSION, hello: helperHello?.() }; }',
        '}',
      ].join('\n'),
    });

    const first = await loadAndGetInfo(entryPath);
    expect(first.version).toBe('helper-v1');
    expect(first.hello).toBeUndefined();

    await fs.writeFile(
      path.join(path.dirname(entryPath), 'helper.mjs'),
      ["export const HELPER_VERSION = 'helper-v2';", "export const helperHello = () => 'hello-v2';"].join('\n'),
    );

    // Without invalidation jiti serves the natively cached helper
    const withoutInvalidate = await loadAndGetInfo(entryPath, { invalidate: false });
    expect(withoutInvalidate.version).toBe('helper-v1');

    // With invalidation the fresh helper is used, including the new export
    const reloaded = await loadAndGetInfo(entryPath);
    expect(reloaded.version).toBe('helper-v2');
    expect(reloaded.hello).toBe('hello-v2');
  });

  it('refreshes deeply imported helpers (level 3) when only the deepest file changed', async () => {
    const entryPath = await writeExtension('deep-chain', {
      'l2.mjs': "export * from './l3.mjs';",
      'l3.mjs': "export const DEEP_VERSION = 'deep-v1';",
      'index.ts': [
        "import { DEEP_VERSION } from './l2.mjs';",
        'export default class Ext {',
        `  ${METADATA}`,
        '  getInfo() { return { deep: DEEP_VERSION }; }',
        '}',
      ].join('\n'),
    });

    expect((await loadAndGetInfo(entryPath)).deep).toBe('deep-v1');

    await fs.writeFile(path.join(path.dirname(entryPath), 'l3.mjs'), "export const DEEP_VERSION = 'deep-v2';");

    expect((await loadAndGetInfo(entryPath)).deep).toBe('deep-v2');
  });

  it('keeps .cjs helper require() chains working and refreshed', async () => {
    const entryPath = await writeExtension('cjs-chain', {
      'other.cjs': "module.exports.TAG = 'other';",
      'helper.cjs': ["const other = require('./other.cjs');", "module.exports.VERSION = 'v1-' + other.TAG;"].join('\n'),
      'index.ts': [
        "import helper from './helper.cjs';",
        'export default class Ext {',
        `  ${METADATA}`,
        '  getInfo() { return { version: helper?.VERSION }; }',
        '}',
      ].join('\n'),
    });

    expect((await loadAndGetInfo(entryPath)).version).toBe('v1-other');

    await fs.writeFile(
      path.join(path.dirname(entryPath), 'helper.cjs'),
      ["const other = require('./other.cjs');", "module.exports.VERSION = 'v2-' + other.TAG;"].join('\n'),
    );

    expect((await loadAndGetInfo(entryPath)).version).toBe('v2-other');

    // Editing only the transitively required file must also be picked up
    await fs.writeFile(path.join(path.dirname(entryPath), 'other.cjs'), "module.exports.TAG = 'other-v2';");

    expect((await loadAndGetInfo(entryPath)).version).toBe('v2-other-v2');
  });

  it('reloads helpers when the extension is reached through a symlinked directory', async () => {
    const realDir = path.join(rootDir, 'real-ext');
    await fs.mkdir(realDir, { recursive: true });
    await fs.writeFile(path.join(realDir, 'helper.mjs'), "export const VERSION = 'v1';");
    await fs.writeFile(
      path.join(realDir, 'index.ts'),
      ["import { VERSION } from './helper.mjs';", 'export default class Ext {', `  ${METADATA}`, '  getInfo() { return { version: VERSION }; }', '}'].join(
        '\n',
      ),
    );
    const linkPath = path.join(rootDir, 'linked-ext');
    await fs.symlink(realDir, linkPath);
    const entryPath = path.join(linkPath, 'index.ts');

    expect((await loadAndGetInfo(entryPath)).version).toBe('v1');

    await fs.writeFile(path.join(realDir, 'helper.mjs'), "export const VERSION = 'v2';");

    expect((await loadAndGetInfo(entryPath)).version).toBe('v2');
  });

  it('keeps modules outside the extension scope at a stable identity across reloads', async () => {
    await fs.writeFile(path.join(rootDir, 'shared.mjs'), 'export const INSTANCE = Math.random();');
    const entryPath = await writeExtension('consumer', {
      'index.ts': [
        "import { INSTANCE } from '../shared.mjs';",
        'export default class Ext {',
        `  ${METADATA}`,
        '  getInfo() { return { instance: INSTANCE }; }',
        '}',
      ].join('\n'),
    });

    const first = await loadAndGetInfo(entryPath);
    const second = await loadAndGetInfo(entryPath);

    expect(second.instance).toBe(first.instance);
  });

  it('does not leak invalidation between scopes with shared prefixes (ext vs ext-v2)', async () => {
    const entryA = await writeExtension('ext', {
      'helper.mjs': 'export const INSTANCE = Math.random();',
      'index.ts': [
        "import { INSTANCE } from './helper.mjs';",
        'export default class Ext {',
        `  ${METADATA}`,
        '  getInfo() { return { instance: INSTANCE }; }',
        '}',
      ].join('\n'),
    });
    const entryB = await writeExtension('ext-v2', {
      'helper.mjs': 'export const INSTANCE = Math.random();',
      'index.ts': [
        "import { INSTANCE } from './helper.mjs';",
        'export default class Ext {',
        `  ${METADATA}`,
        '  getInfo() { return { instance: INSTANCE }; }',
        '}',
      ].join('\n'),
    });

    const firstA = await loadAndGetInfo(entryA);
    const firstB = await loadAndGetInfo(entryB);

    // Reloading ext must not refresh ext-v2's modules
    const secondA = await loadAndGetInfo(entryA);
    const secondB = await loadAndGetInfo(entryB, { invalidate: false });

    expect(secondA.instance).not.toBe(firstA.instance);
    expect(secondB.instance).toBe(firstB.instance);
  });

  describe('getFileMtimes', () => {
    it('tracks module files of a directory extension and ignores non-code files', async () => {
      const entryPath = await writeExtension('walker', {
        'helper.mjs': "export const V = 'v1';",
        'config.json': '{}',
        'index.ts': `export default class Ext { ${METADATA} }`,
      });
      const extDir = path.dirname(entryPath);
      await fs.mkdir(path.join(extDir, 'assets'), { recursive: true });
      await fs.mkdir(path.join(extDir, 'node_modules'), { recursive: true });
      await fs.writeFile(path.join(extDir, 'assets', 'logo.txt'), 'logo');
      await fs.writeFile(path.join(extDir, 'node_modules', 'dep.js'), 'module.exports = {};');
      await fs.mkdir(path.join(extDir, '.hidden'), { recursive: true });
      await fs.writeFile(path.join(extDir, '.hidden', 'secret.ts'), 'export {}');
      await fs.writeFile(path.join(extDir, 'assets', '.dotfile'), 'x');

      const mtimes = await loader.getFileMtimes(entryPath);

      expect(mtimes.size).toBe(2);
      expect(mtimes.has(entryPath)).toBe(true);
      expect(mtimes.has(path.join(path.dirname(entryPath), 'helper.mjs'))).toBe(true);
    });

    it('tracks only the file itself for single-file extensions', async () => {
      const entryPath = path.join(rootDir, 'single.ts');
      await fs.writeFile(entryPath, `export default class Ext { ${METADATA} }`);
      await fs.writeFile(path.join(rootDir, 'sibling.ts'), `export default class Other { ${METADATA} }`);

      const mtimes = await loader.getFileMtimes(entryPath);

      expect(mtimes.size).toBe(1);
      expect(mtimes.has(entryPath)).toBe(true);
    });
  });

  it('supports idempotent hook registration and deregistration', async () => {
    const { registerExtensionResolveHooks } = await import('../extension-module-hooks');

    expect(() => registerExtensionResolveHooks()).not.toThrow();
    expect(() => registerExtensionResolveHooks()).not.toThrow();

    deregisterExtensionResolveHooks();

    // Loading still works after deregistration (without invalidation freshness)
    const entryPath = await writeExtension('after-deregister', {
      'index.ts': `export default class Ext { ${METADATA} }`,
    });
    const module = await loader.loadExtension(entryPath);
    expect(module?.metadata.name).toBe('cache-test');
  });
});
