// Run every retained journal/security/reconstruction/recovery regression against
// the actual registered migration, in a separate disposable fixture/process.
import assert from 'node:assert/strict';
assert.equal(process.env.CREST_SOURCE_EXPORT_TEST_PROFILE,undefined);
process.env.CREST_SOURCE_EXPORT_TEST_PROFILE='registered43';
await import('./source-export-jobs.test.mjs');
