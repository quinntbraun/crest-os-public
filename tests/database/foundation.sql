-- Transactional harness fixtures only. This file is not an application migration.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public, pg_catalog;
SET LOCAL lock_timeout = '3s';

CREATE SCHEMA crest_harness;
CREATE ROLE crest_harness_reader NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE TABLE crest_harness.synthetic_rows (id integer PRIMARY KEY, business_id integer NOT NULL);
INSERT INTO crest_harness.synthetic_rows VALUES (1, 1), (2, 2);
ALTER TABLE crest_harness.synthetic_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_harness.synthetic_rows FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON crest_harness.synthetic_rows FOR SELECT TO crest_harness_reader
  USING (business_id::text = current_setting('crest.test_business', true));
REVOKE ALL ON SCHEMA crest_harness FROM PUBLIC;
GRANT USAGE ON SCHEMA crest_harness, extensions TO crest_harness_reader;
GRANT SELECT ON crest_harness.synthetic_rows TO crest_harness_reader;

SET LOCAL ROLE crest_harness_reader;
SELECT plan(9);
SELECT is(current_setting('server_version_num')::integer / 10000, 17, 'selected PostgreSQL major');
SELECT is((SELECT extversion FROM pg_extension WHERE extname = 'pgtap'), '1.3.3', 'pinned pgTAP version');
SELECT ok((SELECT NOT rolsuper AND NOT rolbypassrls FROM pg_roles WHERE rolname = current_user), 'test reads use restricted role');
SELECT is((SELECT count(*)::integer FROM crest_harness.synthetic_rows), 0, 'missing tenant context denies all rows');
SET LOCAL crest.test_business = '1';
SELECT is((SELECT count(*)::integer FROM crest_harness.synthetic_rows), 1, 'tenant one sees one row');
SELECT ok((SELECT bool_and(business_id = 1) FROM crest_harness.synthetic_rows), 'tenant one cannot see tenant two');
SET LOCAL crest.test_business = '2';
SELECT is((SELECT id FROM crest_harness.synthetic_rows), 2, 'same connection switches to tenant two without leaked rows');
SET LOCAL crest.test_business = '';
SELECT is((SELECT count(*)::integer FROM crest_harness.synthetic_rows), 0, 'cleared context denies all rows');
SELECT throws_ok('INSERT INTO crest_harness.synthetic_rows VALUES (3, 1)', '42501', 'permission denied for table synthetic_rows', 'reader cannot write');
RESET ROLE;
SELECT * FROM finish();
-- Caller always rolls back schema, rows, extension changes and temporary role.
