// Genuine Auth/TOTP/HTTP review suite on actual registered46, separately from45+proposal.
import assert from 'node:assert/strict';
assert.equal(process.env.CREST_QUOTE_REVIEW_TEST_PROFILE,undefined);
process.env.CREST_QUOTE_REVIEW_TEST_PROFILE='registered46';
await import('./quote-review-auth.test.mjs');
