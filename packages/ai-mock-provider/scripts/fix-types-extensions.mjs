import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const typesDir = 'dist/types';

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

const files = await walk(typesDir);
for (const filePath of files) {
  if (!filePath.endsWith('.d.ts') && !filePath.endsWith('.d.mts')) {
    continue;
  }
  const content = await readFile(filePath, 'utf8');
  if (!/from '\.[^']*'/.test(content)) {
    continue;
  }
  const isModule = filePath.endsWith('.d.mts');
  const updated = content.replace(/from '(\.[^']*?)'/g, `from '$1${isModule ? '.mjs' : '.cjs'}'`);
  await writeFile(filePath, updated);
}
