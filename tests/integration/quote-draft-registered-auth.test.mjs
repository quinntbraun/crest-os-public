// The nine genuine Auth/TOTP/provider/HTTP cases run on the actual registered45
// migration, separately from frozen44 plus the explicit construction proposals.
import assert from 'node:assert/strict';
assert.equal(process.env.CREST_QUOTE_TEST_PROFILE,undefined);
process.env.CREST_QUOTE_TEST_PROFILE='registered45';
await import('./quote-draft-http.test.mjs');
