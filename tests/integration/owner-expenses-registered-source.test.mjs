// Financial source/history acceptance on actual registered49, not overlays.
import assert from 'node:assert/strict';
assert.equal(process.env.CREST_EXPENSE_SOURCE_TEST_PROFILE,undefined);
process.env.CREST_EXPENSE_SOURCE_TEST_PROFILE='registered49';
await import('./owner-expenses-source.test.mjs');
