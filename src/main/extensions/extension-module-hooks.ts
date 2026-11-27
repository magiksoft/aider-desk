import path from 'path';
import fs from 'fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

import logger from '@/logger';

/**
 * Scope of files that belong to a single extension for module-cache invalidation.
 *
 * Directory extensions (a folder with an index file) own every module inside their
 * folder, while single-file extensions own only their own file.
 */
export type ExtensionModuleScope = {
  kind: 'directory' | 'file';
  root: string;
};

interface ScopeRegistration {
  kind: 'directory' | 'file';
  // Normalized path variants (configured path + realpath when resolvable)
  roots: string[];
}

const REWRITEABLE_EXTENSIONS = new Set(['.mjs', '.cjs', '.js']);
const NODE_MODULES_SEGMENT = `${path.sep}node_modules${path.sep}`;

const scopes = new Map<string, ScopeRegistration>();
const loadStamps = new Map<string, string>();

let hooksHandle: { deregister: () => void } | null = null;
let stampSequence = 0;

const isWindows = process.platform === 'win32';

const normalizePathForMatching = (p: string): string => {
  // path.resolve normalizes absolute paths and resolves relative ones against cwd
  const resolved = path.resolve(p);
  return isWindows ? resolved.toLowerCase() : resolved;
};

const realpathOrSelf = (p: string): string => {
  try {
    return fs.realpathSync(p);
  } catch {
    // Path may not exist yet; fall back to the given path
    return p;
  }
};

/**
 * Determines the module scope of an extension from its entry file path:
 * - directory extensions (`<root>/<name>/index.ts`) own the whole `<root>/<name>/` folder
 * - single-file extensions (`<root>/<name>.ts`) own only their own file
 */
export const extensionScopeForEntry = (entryFilePath: string): ExtensionModuleScope => {
  const basename = path.basename(entryFilePath);
  const isIndexEntry = basename.startsWith('index.');
  return {
    kind: isIndexEntry ? 'directory' : 'file',
    root: isIndexEntry ? path.dirname(entryFilePath) : entryFilePath,
  };
};

const normalizeForComparison = (p: string): string => (isWindows ? p.toLowerCase() : p);

const pathMatchesRoot = (normalizedPath: string, registration: ScopeRegistration): boolean => {
  for (const root of registration.roots) {
    if (registration.kind === 'file') {
      if (normalizedPath === root) {
        return true;
      }
    } else if (normalizedPath.startsWith(root + path.sep)) {
      return true;
    }
  }
  return false;
};

/**
 * Checks whether a file path belongs to the given extension scope.
 * Paths inside a `node_modules` folder are never part of an extension scope, so
 * dependencies (including native addons) keep their cached identity.
 * Path comparisons use path.sep boundaries so `ext` never matches `ext-v2`,
 * and are case-insensitive on Windows.
 */
export const isPathInExtensionScope = (filePath: string, scope: ExtensionModuleScope): boolean => {
  if (filePath.includes(NODE_MODULES_SEGMENT)) {
    return false;
  }
  const registration = scopes.get(normalizePathForMatching(scope.root));
  if (!registration) {
    return false;
  }
  if (pathMatchesRoot(normalizeForComparison(filePath), registration)) {
    return true;
  }
  // Node resolves symlinks, so also compare against the real path
  return pathMatchesRoot(normalizeForComparison(realpathOrSelf(filePath)), registration);
};

const matchScopeKey = (filePath: string): string | null => {
  const normalized = normalizeForComparison(filePath);
  for (const [scopeKey, registration] of scopes) {
    if (pathMatchesRoot(normalized, registration)) {
      return scopeKey;
    }
  }
  // The raw path didn't match any scope; resolve symlinks once and retry
  const realPath = normalizeForComparison(realpathOrSelf(filePath));
  if (realPath === normalized) {
    return null;
  }
  for (const [scopeKey, registration] of scopes) {
    if (pathMatchesRoot(realPath, registration)) {
      return scopeKey;
    }
  }
  return null;
};

/**
 * Registers process-wide module resolution hooks that keep natively imported
 * extension modules (`.mjs`, `.cjs`, plain `.js`) fresh across extension reloads.
 *
 * Node caches natively imported modules by URL for the lifetime of the process,
 * and neither jiti's `moduleCache: false` nor `require.cache` deletion can evict
 * them. The hook rewrites resolved extension file URLs to include the extension's
 * current load stamp (`?load=<stamp>`), which makes Node treat reloaded extension
 * files as new modules while leaving shared dependencies (node_modules outside the
 * extension scope) untouched.
 *
 * Hooks apply at any import depth: once a module inside an extension scope is loaded
 * natively, Node resolves its own imports relative to the stamped URL, so deeply
 * imported helpers are refreshed on reload as well.
 */
export const registerExtensionResolveHooks = (): void => {
  if (hooksHandle) {
    return;
  }

  if (typeof registerHooks !== 'function') {
    logger.warn('[Extensions] module.registerHooks is not available; imported extension helper modules will not be refreshed on reload');
    return;
  }

  hooksHandle = registerHooks({
    resolve: (specifier, context, nextResolve) => {
      const result = nextResolve(specifier, context);
      try {
        if (result.url && result.url.startsWith('file:')) {
          const filePath = fileURLToPath(result.url);
          if (isRewriteableModuleFile(filePath)) {
            const scopeKey = matchScopeKey(filePath);
            const stamp = scopeKey ? loadStamps.get(scopeKey) : undefined;
            if (stamp) {
              const url = new URL(result.url);
              url.searchParams.set('load', stamp);
              return { url: url.href, format: result.format, shortCircuit: true };
            }
          }
        }
      } catch (error) {
        logger.debug('[Extensions] Failed to apply load stamp to module URL:', error);
      }
      return result;
    },
  });
};

/** Removes the process-wide module resolution hooks and forgets all scopes and stamps. */
export const deregisterExtensionResolveHooks = (): void => {
  if (hooksHandle) {
    hooksHandle.deregister();
    hooksHandle = null;
  }
  scopes.clear();
  loadStamps.clear();
};

const isRewriteableModuleFile = (filePath: string): boolean => {
  if (filePath.includes(NODE_MODULES_SEGMENT)) {
    return false;
  }
  return REWRITEABLE_EXTENSIONS.has(path.extname(filePath));
};

/**
 * Registers an extension scope for load-stamping and CJS cache invalidation.
 * Idempotent: re-registering the same scope is a no-op that keeps the current stamp.
 */
export const registerExtensionScope = (scope: ExtensionModuleScope): void => {
  const scopeKey = normalizePathForMatching(scope.root);
  if (scopes.has(scopeKey)) {
    return;
  }

  const roots = new Set<string>([normalizePathForMatching(scope.root)]);
  const realPath = normalizePathForMatching(realpathOrSelf(scope.root));
  roots.add(realPath);

  scopes.set(scopeKey, { kind: scope.kind, roots: Array.from(roots) });
};

/** Forgets a previously registered extension scope and its load stamp. */
export const unregisterExtensionScope = (scope: ExtensionModuleScope): void => {
  const scopeKey = normalizePathForMatching(scope.root);
  scopes.delete(scopeKey);
  loadStamps.delete(scopeKey);
};

/**
 * Assigns a fresh load stamp to an extension scope. Subsequent module resolutions
 * inside the scope produce new URLs, so natively imported extension modules are
 * re-executed on the next import.
 */
export const bumpExtensionLoadStamp = (scope: ExtensionModuleScope): void => {
  const scopeKey = normalizePathForMatching(scope.root);
  stampSequence += 1;
  loadStamps.set(scopeKey, `r${stampSequence}-${Date.now()}`);
};
