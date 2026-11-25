import { describe, expect, it } from 'vitest';

import { runHarness } from '../harness/scenarios.js';

describe('ai-mock-provider end-to-end harness (real Vercel AI SDK)', () => {
  it('passes every harness check', async () => {
    const results = await runHarness();

    const failures = results.filter((result) => !result.passed);
    if (failures.length > 0) {
      const details = failures.map((result) => `✗ ${result.name}: ${result.details}`).join('\n');
      throw new Error(`${failures.length} harness check(s) failed:\n${details}`);
    }

    expect(results.length).toBeGreaterThanOrEqual(15);
    for (const result of results) {
      expect(result.passed, result.name).toBe(true);
    }
  }, 120000);
});
