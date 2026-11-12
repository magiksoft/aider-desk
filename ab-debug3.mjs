import path from 'path';
import os from 'os';
import fs from 'fs';
import jiti from 'jiti';
process.env.AGENT_BROWSER_BIN = '/tmp/ab-stub.sh';
fs.writeFileSync('/tmp/blocker-file', 'x');
const root = '/home/wladimiiir/Projects/aider-desk';
const j = jiti(import.meta.url, { moduleCache: false, fsCache: false });
const mod = await j.import(path.join(root, 'packages/extensions/extensions/agent-browser/index.ts'));
const ext = new mod.default();
const context = {
  getProjectDir: () => '/tmp/blocker-file',
  getTaskContext: () => ({ data: { id: 't' } }),
  log: (m) => console.log('LOG:', m),
  addDisposable: () => {},
};
const tools = ext.getTools(context);
const shot = tools.find((t) => t.name === 'agent_browser_screenshot');
const res = await shot.execute({}, undefined, context);
console.log('result:', res.content[0].text);
process.exit(0);
