// All sixteen retained genuine MFA/provider/catalog HTTP cases on the actual
// registered44 upgrade, separate from the frozen43-plus-proposal fixture.
import assert from 'node:assert/strict';
assert.equal(process.env.CREST_CATALOG_TEST_PROFILE,undefined);
process.env.CREST_CATALOG_TEST_PROFILE='registered44';
await import('./service-catalog-auth.test.mjs');
