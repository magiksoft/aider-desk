#!/usr/bin/env node

/**
 * Fetches agent-browser skills into the extension's skills/ directory.
 *
 * Source chain (first non-empty wins):
 *   1. Latest from the agent-browser repo (raw.githubusercontent.com, main branch)
 *   2. `agent-browser skills get <name>` of a resolved CLI binary (global or bundled)
 *   3. skill-data/ files shipped inside the bundled agent-browser npm package (offline fallback)
 *
 * Best-effort by design: this script must never fail the extension install.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const EXTENSION_DIR = path.join(__dirname, '..');
const SKILLS_DIR = path.join(EXTENSION_DIR, 'skills');
const SKILL_NAMES = ['core', 'dogfood', 'electron'];
const RAW_SKILL_BASE_URL = 'https://raw.githubusercontent.com/vercel-labs/agent-browser/main/skill-data';
const HTTP_TIMEOUT_MS = 15000;
const CLI_TIMEOUT_MS = 30000;

const AIDERDESK_NOTE = [
  '',
  '## Using agent-browser within AiderDesk',
  '',
  'This skill was loaded by the AiderDesk Agent Browser extension. Run agent-browser commands through the extension tools instead of a shell:',
  '',
  '- Prefer the dedicated tools when they match the task: `agent_browser_open`, `agent_browser_snapshot`, `agent_browser_click`, `agent_browser_fill`, `agent_browser_screenshot`.',
  '- For any other CLI command, call `agent_browser_execute`, for example `{ "args": ["get", "text", "#price"] }` or `{ "args": ["skills", "get", "core", "--ref", "commands"] }`.',
  '- The extension already runs every command in a per-project session (`--session`). Do not add `--session` yourself unless explicitly asked.',
  '- If a command reports that the browser is not installed, call `agent_browser_execute` with `["install"]` once (downloads Chrome for Testing, may take several minutes), then retry.',
  '- Take a new snapshot after navigating or after the DOM changes before using element refs again.',
  '',
].join('\n');

const isMusl = () => {
  if (process.platform !== 'linux') {
    return false;
  }
  return fs.existsSync('/lib/ld-musl-x86_64.so.1') || fs.existsSync('/lib/ld-musl-aarch64.so.1');
};

const resolveBundledPackageRoot = () => {
  try {
    const pkgPath = require.resolve('agent-browser/package.json', { paths: [EXTENSION_DIR] });
    return path.dirname(pkgPath);
  } catch {
    return null;
  }
};

const resolveBundledBinaryPath = () => {
  const pkgRoot = resolveBundledPackageRoot();
  if (!pkgRoot) {
    return null;
  }
  const osKey = process.platform === 'linux' && isMusl() ? 'linux-musl' : process.platform;
  const archKey = process.platform === 'win32' && process.arch === 'arm64' ? 'x64' : process.arch;
  const ext = process.platform === 'win32' ? '.exe' : '';
  return path.join(pkgRoot, 'bin', `agent-browser-${osKey}-${archKey}${ext}`);
};

const fetchUrl = (url, redirectCount = 0) =>
  new Promise((resolve) => {
    const request = https.get(url, { timeout: HTTP_TIMEOUT_MS }, (response) => {
      const location = response.headers.location;
      if (response.statusCode >= 300 && response.statusCode < 400 && location && redirectCount < 3) {
        response.resume();
        resolve(fetchUrl(new URL(location, url).href, redirectCount + 1));
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        resolve(response.statusCode === 200 && body ? body : null);
      });
    });
    request.on('timeout', () => {
      request.destroy();
      resolve(null);
    });
    request.on('error', () => resolve(null));
  });

const readFromCli = (name) => {
  const binary = resolveBundledBinaryPath();
  if (!binary || !fs.existsSync(binary)) {
    return null;
  }
  try {
    const result = spawnSync(binary, ['skills', 'get', name], { encoding: 'utf8', timeout: CLI_TIMEOUT_MS });
    return result.status === 0 && result.stdout ? result.stdout : null;
  } catch {
    return null;
  }
};

const readFromBundledSkillData = (name) => {
  const pkgRoot = resolveBundledPackageRoot();
  if (!pkgRoot) {
    return null;
  }
  try {
    const content = fs.readFileSync(path.join(pkgRoot, 'skill-data', name, 'SKILL.md'), 'utf8');
    return content.trim() ? content : null;
  } catch {
    return null;
  }
};

const writeSkill = (name, content) => {
  const dir = path.join(SKILLS_DIR, `agent-browser-${name}`);
  fs.mkdirSync(dir, { recursive: true });
  const renamed = content.replace(/^name:\s*(.+)$/m, `name: agent-browser-${name}`);
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `${renamed.trimEnd()}\n${AIDERDESK_NOTE}`, 'utf8');
};

const main = async () => {
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
  for (const name of SKILL_NAMES) {
    const content = (await fetchUrl(`${RAW_SKILL_BASE_URL}/${name}/SKILL.md`)) ?? readFromCli(name) ?? readFromBundledSkillData(name);
    if (content) {
      writeSkill(name, content);
    }
  }
  fs.writeFileSync(path.join(SKILLS_DIR, '.refreshed-at.json'), JSON.stringify({ refreshedAt: new Date().toISOString() }), 'utf8');
};

main().catch(() => {});
process.exitCode = 0;
