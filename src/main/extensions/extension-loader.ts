import path from 'path';
import fs from 'fs/promises';

import { createJiti, type JitiOptions } from 'jiti';
import { Extension, ExtensionMetadata } from '@common/extensions';

import {
  bumpExtensionLoadStamp,
  extensionScopeForEntry,
  isPathInExtensionScope,
  registerExtensionResolveHooks,
  registerExtensionScope,
  type ExtensionModuleScope,
} from './extension-module-hooks';

import logger from '@/logger';
import { AIDER_DESK_EXTENSION_JITI_CACHE_DIR } from '@/constants';

// Module file extensions tracked for change detection and natively imported helper types
export const MODULE_FILE_EXTENSIONS = new Set(['.ts', '.js', '.tsx', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);
const MAX_MTIME_WALK_DEPTH = 8;

// Define the interface for the loaded module
interface ExtensionModule {
  default: {
    new (): Extension;
    metadata?: ExtensionMetadata;
  };
}

// Base jiti options shared across all instances
const baseJitiOptions: JitiOptions = {
  fsCache: AIDER_DESK_EXTENSION_JITI_CACHE_DIR,
  moduleCache: false,
  alias: {
    zod: require.resolve('zod'),
    '@aiderdesk/extensions': require.resolve('@aiderdesk/extensions'),
  },
};

export class ExtensionLoader {
  private jitiCache: Map<string, ReturnType<typeof createJiti>> = new Map();

  constructor() {
    registerExtensionResolveHooks();
  }

  /**
   * Invalidates all module caches for an extension scope before (re)loading it.
   *
   * jiti re-evaluates TypeScript entry files on every load, but natively imported
   * helper modules (.mjs, .cjs, plain .js) are cached by Node's module loaders for
   * the lifetime of the process. Bumping the extension's load stamp (via module
   * resolve hooks) and purging CJS cache entries makes such helpers re-execute on
   * the next import.
   */
  invalidateExtensionModules(filePath: string): void {
    const scope = extensionScopeForEntry(filePath);
    registerExtensionScope(scope);
    bumpExtensionLoadStamp(scope);
    this.purgeCjsCache(scope);
  }

  private purgeCjsCache(scope: ExtensionModuleScope): void {
    let purged = 0;
    for (const cacheKey of Object.keys(require.cache)) {
      // Native addons cannot be safely unloaded and reloaded
      if (cacheKey.endsWith('.node')) {
        continue;
      }
      if (isPathInExtensionScope(cacheKey, scope)) {
        delete require.cache[cacheKey];
        purged += 1;
      }
    }
    if (purged > 0) {
      logger.debug(`[Extensions] Purged ${purged} cached module(s) for ${scope.root}`);
    }
  }

  /**
   * Collects current mtimes of all module files belonging to an extension.
   * Used to detect changes in helper files that don't touch the entry file itself.
   * Ignores node_modules, dotfiles, and non-code files (e.g. config.json).
   */
  async getFileMtimes(entryFilePath: string): Promise<Map<string, number>> {
    const scope = extensionScopeForEntry(entryFilePath);
    const mtimes = new Map<string, number>();

    if (scope.kind === 'file') {
      const stat = await fs.stat(scope.root).catch(() => null);
      if (stat && MODULE_FILE_EXTENSIONS.has(path.extname(scope.root))) {
        mtimes.set(scope.root, stat.mtimeMs);
      }
      return mtimes;
    }

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > MAX_MTIME_WALK_DEPTH) {
        return;
      }
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (entry.name.startsWith('.')) {
          continue;
        }
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules') {
            continue;
          }
          await walk(fullPath, depth + 1);
        } else if (entry.isFile() && MODULE_FILE_EXTENSIONS.has(path.extname(entry.name))) {
          const stat = await fs.stat(fullPath).catch(() => null);
          if (stat) {
            mtimes.set(fullPath, stat.mtimeMs);
          }
        }
      }
    };

    await walk(scope.root, 0);
    return mtimes;
  }

  /**
   * Get or create a jiti instance for a specific extension directory.
   * This ensures module resolution happens relative to the extension's directory.
   */
  private getJitiForExtension(filePath: string): ReturnType<typeof createJiti> {
    const parsedPath = path.parse(filePath);
    const extensionDir = parsedPath.name === 'index' ? parsedPath.dir : path.dirname(filePath);

    // Check if we already have a jiti instance for this directory
    const cached = this.jitiCache.get(extensionDir);
    if (cached) {
      return cached;
    }

    // Create a new jiti instance with the extension directory as base
    const jiti = createJiti(extensionDir, baseJitiOptions);
    this.jitiCache.set(extensionDir, jiti);

    return jiti;
  }

  private deriveExtensionName(filePath: string): string {
    const parsedPath = path.parse(filePath);
    const filename = parsedPath.name;

    // If the file is index.ts or index.js, use the parent folder name
    if (filename === 'index') {
      const parentDir = path.basename(parsedPath.dir);
      return parentDir;
    }

    // Otherwise, use the filename without extension
    return filename;
  }

  async loadExtension(filePath: string): Promise<{ extension: Extension; metadata: ExtensionMetadata } | null> {
    try {
      // Use extension-specific jiti instance for proper module resolution
      const jiti = this.getJitiForExtension(filePath);

      // Use jiti to load the file
      // jiti handles TypeScript compilation on the fly
      const module = (await jiti.import(filePath)) as ExtensionModule;

      // Check if default export exists
      if (!module.default) {
        logger.error(`Extension file ${path.basename(filePath)} does not have a default export.`);
        return null;
      }

      const ExtensionClass = module.default;

      // Check if it's a class/constructor
      if (typeof ExtensionClass !== 'function') {
        logger.error(`Extension file ${path.basename(filePath)} default export is not a class.`);
        return null;
      }

      // Check for static metadata, or generate from filename
      let metadata = ExtensionClass.metadata;
      if (!metadata) {
        const generatedName = this.deriveExtensionName(filePath);
        metadata = {
          name: generatedName,
          version: '1.0.0',
        };
        logger.info(`Extension file ${path.basename(filePath)} is missing metadata. Generated name: ${generatedName}`);
      }

      // Instantiate the extension
      const extension = new ExtensionClass();

      return { extension, metadata };
    } catch (error) {
      logger.error(`Failed to load extension from ${filePath}:`, error);
      return null;
    }
  }
}
