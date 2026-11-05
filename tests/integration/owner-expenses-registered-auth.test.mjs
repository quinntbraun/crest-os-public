// Same genuine MFA/client/HTTP/SDK journey on the actual registered49 migration,
// separate from frozen48 plus explicit construction overlays.
import assert from 'node:assert/strict';
assert.equal(process.env.CREST_EXPENSE_TEST_PROFILE,undefined);
process.env.CREST_EXPENSE_TEST_PROFILE='registered49';
await import('./owner-expenses-receipt-http.test.mjs');
