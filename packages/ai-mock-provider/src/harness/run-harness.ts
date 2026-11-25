import { runHarness } from './scenarios.js';

const main = async () => {
  // eslint-disable-next-line no-console
  console.log('\nai-mock-provider E2E harness — running against the real Vercel AI SDK\n');
  const results = await runHarness();

  const nameWidth = Math.max(...results.map((result) => result.name.length)) + 2;
  // eslint-disable-next-line no-console
  console.log(`${'CHECK'.padEnd(nameWidth)}STATUS  TIME       DETAILS`);
  // eslint-disable-next-line no-console
  console.log('─'.repeat(nameWidth + 90));

  for (const result of results) {
    const status = result.passed ? 'PASS' : 'FAIL';
    // eslint-disable-next-line no-console
    console.log(`${result.name.padEnd(nameWidth)}${status}    ${String(result.durationMs).padStart(5)}ms   ${result.details}`);
  }

  const passed = results.filter((result) => result.passed).length;
  const failed = results.length - passed;
  const totalMs = results.reduce((total, result) => total + result.durationMs, 0);

  // eslint-disable-next-line no-console
  console.log('─'.repeat(nameWidth + 90));
  // eslint-disable-next-line no-console
  console.log(`\n${passed}/${results.length} checks passed in ${totalMs}ms${failed > 0 ? ` — ${failed} FAILED` : ' — ALL PASSED'}\n`);

  if (failed > 0) {
    process.exitCode = 1;
  }
};

void main();
