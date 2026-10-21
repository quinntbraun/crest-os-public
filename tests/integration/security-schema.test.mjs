import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { applyTestMigrations } from "../../src/tooling/migration-coordinator.ts";
import { testDatabaseConnection } from "../../src/tooling/test-database.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const base = testDatabaseConnection(process.env.CREST_ENV, process.env.CREST_TEST_DATABASE_URL);
const admin = new pg.Client({ connectionString: base, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
const roles = ["crest_schema_owner", "crest_command_owner", "crest_web", "crest_worker", "crest_recovery"];
const schemas = ["crest", "crest_private", "crest_commands"];
const ownedDatabases = new Set();
const ownedRoles = new Set();
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const cliPath = fileURLToPath(new URL(`../../.local/tools/supabase/supabase${process.platform === "win32" ? ".exe" : ""}`, import.meta.url));
let client;
let target;
let ledgerRoot;
let initialReceipt;
let upgradedReceipt;
let boundaryWorkspace;

async function database() {
  const name = `crest_migrate_${randomBytes(8).toString("hex")}`;
  assert.match(name, /^crest_migrate_[a-f0-9]{16}$/);
  await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
  ownedDatabases.add(name); // Never claim ownership before CREATE succeeds.
  const url = new URL(base); url.pathname = `/${name}`;
  return url.toString();
}

async function connect(url) {
  const connection = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
  await connection.connect();
  return connection;
}

const apply = (connectionString, ledger, workspace = boundaryWorkspace, extra = {}) => applyTestMigrations({
  environment: "test", connectionString, ledgerRoot: ledger, workspace, cliPath, sourceCommit, ...extra
});

before(async () => {
  await admin.connect();
  const preexisting = await admin.query("SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])", [roles]);
  assert.deepEqual(preexisting.rows, [], "refuse to alter/drop roles not created by this suite");
  await mkdir(join(root, ".local/security-integration"), { recursive: true });
  const workspace = await mkdtemp(join(root, ".local/security-integration/case-"));
  await mkdir(join(workspace, "supabase/migrations"), { recursive: true });
  await writeFile(join(workspace, "supabase/migration-checksums.json"), '{"schemaVersion":1,"migrations":[]}\n');
  // Keep the schema1 regression suite on its actual immutable migration prefix.
  boundaryWorkspace = join(workspace, "schema1");
  await mkdir(join(boundaryWorkspace, "supabase/migrations"), { recursive: true });
  const registry = JSON.parse(await readFile(join(root, "supabase/migration-checksums.json"), "utf8"));
  registry.migrations = registry.migrations.filter((m) => m.version <= "20261021031357");
  assert.equal(registry.migrations.length, 1);
  for (const m of registry.migrations) await writeFile(join(boundaryWorkspace, "supabase/migrations", m.file), await readFile(join(root, "supabase/migrations", m.file)));
  await writeFile(join(boundaryWorkspace, "supabase/migration-checksums.json"), JSON.stringify(registry) + "\n");
  ledgerRoot = join(workspace, "ledger");
  target = await database();
  initialReceipt = await apply(target, ledgerRoot, workspace, { bootstrapEmpty: true });
  try { upgradedReceipt = await apply(target, ledgerRoot); }
  finally {
    // The names were absent in this isolated test cluster before our CLI apply.
    const created = await admin.query("SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])", [roles]);
    for (const row of created.rows) ownedRoles.add(row.rolname);
  }
  client = await connect(target);
});

after(async () => {
  await client?.end();
  for (const name of ownedDatabases) {
    assert.match(name, /^crest_migrate_[a-f0-9]{16}$/);
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  for (const role of ownedRoles) {
    assert(roles.includes(role));
    await admin.query(`DROP ROLE "${role}"`);
  }
  await admin.end();
});

async function transaction(body) {
  await client.query("BEGIN");
  try { await body(); }
  finally { await client.query("ROLLBACK"); }
}

// Failed statements are isolated so each denial is actually tested on a live transaction.
async function denied(sql, code = "42501", connection = client) {
  await connection.query("SAVEPOINT expected_denial");
  try { await assert.rejects(connection.query(sql), (error) => error.code === code); }
  finally { await connection.query("ROLLBACK TO SAVEPOINT expected_denial"); }
}

test("schema0 upgrades through CLI receipts; schema1 no-op preserves actual SQL history", async () => {
  assert.equal(initialReceipt.history.length, 0);
  assert.equal(upgradedReceipt.history.length, 1);
  assert.equal(upgradedReceipt.history[0].version, "20261021031357");
  assert(upgradedReceipt.previousReceiptSha256);
  const noop = await apply(target, ledgerRoot);
  assert.deepEqual(noop.history, upgradedReceipt.history);
  assert.notEqual(noop.previousReceiptSha256, upgradedReceipt.previousReceiptSha256);
});

test("five separate principals have no login, escalation, RLS bypass, settings or memberships", async () => {
  const result = await client.query("SELECT rolname, rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolconfig FROM pg_roles WHERE rolname=ANY($1::text[]) ORDER BY rolname", [roles]);
  assert.equal(result.rowCount, 5);
  for (const row of result.rows) {
    assert.equal(row.rolconfig, null);
    for (const key of ["rolcanlogin", "rolinherit", "rolsuper", "rolcreatedb", "rolcreaterole", "rolreplication", "rolbypassrls"]) assert.equal(row[key], false, `${row.rolname}.${key}`);
  }
  const memberships = await client.query("SELECT count(*)::int AS n FROM pg_auth_members WHERE roleid IN (SELECT oid FROM pg_roles WHERE rolname=ANY($1::text[])) OR member IN (SELECT oid FROM pg_roles WHERE rolname=ANY($1::text[]))", [roles]);
  assert.equal(memberships.rows[0].n, 0);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM pg_authid WHERE rolname=ANY($1::text[]) AND rolpassword IS NOT NULL", [roles])).rows[0].n, 0);
});

test("schema ownership and exact role grants exclude PUBLIC and provider browser roles", async () => {
  const result = await client.query("SELECT nspname, pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname=ANY($1::text[])", [schemas]);
  assert.equal(result.rowCount, 3);
  for (const row of result.rows) assert.equal(row.owner, "crest_schema_owner");
  const publicGrants = await client.query("SELECT count(*)::int AS n FROM pg_namespace n, LATERAL aclexplode(n.nspacl) a WHERE n.nspname=ANY($1::text[]) AND a.grantee=0", [schemas]);
  assert.equal(publicGrants.rows[0].n, 0);
  const provider = (await client.query("SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])", [["anon", "authenticated", "service_role"]])).rows.map((r) => r.rolname);
  assert(provider.includes("anon") && provider.includes("authenticated"), "pinned provider image must supply browser roles");
  for (const role of [...roles, ...provider]) {
    for (const schema of schemas) {
      const p = (await client.query("SELECT has_schema_privilege($1,$2,'USAGE') AS usage, has_schema_privilege($1,$2,'CREATE') AS create", [role, schema])).rows[0];
      assert.equal(p.create, role === "crest_schema_owner", `${role}.${schema} CREATE`);
      const usage = role === "crest_schema_owner" || role === "crest_command_owner" || (role === "crest_web" && schema !== "crest_private");
      assert.equal(p.usage, usage, `${role}.${schema} USAGE`);
    }
  }
  assert.equal((await client.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1::text[])", [schemas])).rows[0].n, 0);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=ANY($1::text[])", [schemas])).rows[0].n, 0);
});

test("objects created by either intended owner have no implicit PUBLIC or runtime access", async () => transaction(async () => {
  await client.query("SET LOCAL ROLE crest_schema_owner");
  await client.query("CREATE TABLE crest.boundary_probe(id integer); CREATE SEQUENCE crest.boundary_sequence; CREATE TYPE crest.boundary_type AS (id integer); CREATE FUNCTION crest_commands.schema_probe() RETURNS integer LANGUAGE sql SET search_path=pg_catalog,pg_temp AS 'SELECT 42'");
  await client.query("RESET ROLE");
  // Only a transaction-local migration fixture may briefly enable routine creation.
  await client.query("GRANT CREATE ON SCHEMA crest_commands TO crest_command_owner; SET LOCAL ROLE crest_command_owner");
  await client.query("CREATE FUNCTION crest_commands.command_probe() RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS 'SELECT 42'");
  await client.query("RESET ROLE; REVOKE CREATE ON SCHEMA crest_commands FROM crest_command_owner");
  for (const name of ["schema_probe", "command_probe"]) {
    const grants = await client.query("SELECT a.grantee FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace, LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname='crest_commands' AND p.proname=$1 AND a.grantee<>p.proowner", [name]);
    assert.equal(grants.rowCount, 0);
  }
  const type = await client.query("SELECT a.grantee FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace, LATERAL aclexplode(COALESCE(t.typacl,acldefault('T',t.typowner))) a WHERE n.nspname='crest' AND t.typname='boundary_type' AND a.grantee<>t.typowner");
  assert.equal(type.rowCount, 0);
  for (const role of ["crest_web", "crest_worker", "crest_recovery", "crest_command_owner"]) {
    await client.query(`SET LOCAL ROLE "${role}"`);
    await denied("SELECT * FROM crest.boundary_probe");
    await denied("SELECT nextval('crest.boundary_sequence')");
    await denied("SELECT crest_commands.schema_probe()");
    if (role !== "crest_command_owner") await denied("SELECT crest_commands.command_probe()");
    await client.query("RESET ROLE");
  }
  await client.query("GRANT EXECUTE ON FUNCTION crest_commands.command_probe() TO crest_web; SET LOCAL ROLE crest_web");
  assert.equal((await client.query("SELECT crest_commands.command_probe() AS value")).rows[0].value, 42);
  await denied("SELECT crest_commands.schema_probe()");
}));

test("explicit FORCE RLS denies all rows to web, command owner and table owner without policies", async () => transaction(async () => {
  await client.query("SET LOCAL ROLE crest_schema_owner; CREATE TABLE crest.rls_probe(id integer, business_id integer); ALTER TABLE crest.rls_probe ENABLE ROW LEVEL SECURITY; ALTER TABLE crest.rls_probe FORCE ROW LEVEL SECURITY; RESET ROLE");
  await client.query("INSERT INTO crest.rls_probe VALUES (1,1),(2,2); GRANT SELECT ON crest.rls_probe TO crest_web,crest_command_owner");
  for (const role of ["crest_web", "crest_command_owner", "crest_schema_owner"]) {
    await client.query(`SET LOCAL ROLE "${role}"; SET LOCAL crest.business_id='1'`);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM crest.rls_probe")).rows[0].n, 0);
    await client.query("RESET ROLE");
  }
}));

test("actual web login cannot change schema, assume elevated roles, write or truncate past RLS", async () => {
  // SET ROLE from a superuser session is insufficient to test escalation: SET ROLE
  // checks session_user. Authenticate a genuinely restricted, suite-owned login.
  const login = `crest_boundary_login_${randomBytes(8).toString("hex")}`;
  const password = randomBytes(32).toString("hex");
  assert.match(login, /^crest_boundary_login_[a-f0-9]{16}$/);
  await client.query("BEGIN; SET LOCAL ROLE crest_schema_owner; CREATE TABLE crest.write_probe(id integer); ALTER TABLE crest.write_probe ENABLE ROW LEVEL SECURITY; ALTER TABLE crest.write_probe FORCE ROW LEVEL SECURITY; RESET ROLE; COMMIT");
  let created = false;
  let restricted;
  try {
    await admin.query(`CREATE ROLE "${login}" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
    created = true;
    await admin.query(`GRANT crest_web TO "${login}" WITH INHERIT FALSE, SET TRUE`);
    const url = new URL(target); url.username = login; url.password = password;
    restricted = await connect(url.toString());
    await restricted.query("BEGIN; SET LOCAL ROLE crest_web");
    const identity = (await restricted.query("SELECT session_user, current_user")).rows[0];
    assert.equal(identity.session_user, login);
    assert.equal(identity.current_user, "crest_web");
    for (const sql of [
      "CREATE TABLE crest.injected(id integer)", "CREATE TABLE public.injected(id integer)",
      "CREATE SCHEMA injected", "CREATE ROLE crest_injected", "SET ROLE crest_schema_owner",
      "SET ROLE crest_command_owner", "SET ROLE crest_recovery", "SET ROLE service_role",
      "ALTER TABLE crest.write_probe DISABLE ROW LEVEL SECURITY",
      "INSERT INTO crest.write_probe VALUES(1)", "UPDATE crest.write_probe SET id=2",
      "DELETE FROM crest.write_probe", "TRUNCATE crest.write_probe"
    ]) await denied(sql, "42501", restricted);
  } finally {
    if (restricted) { await restricted.query("ROLLBACK"); await restricted.end(); }
    if (created) await admin.query(`DROP ROLE "${login}"`);
    await client.query("DROP TABLE crest.write_probe");
  }
});

test("fresh schema1 apply reuses only reviewed cluster roles; namespaces remain isolated per database", async () => {
  const fresh = await database();
  const receipt = await apply(fresh, `${ledgerRoot}-fresh`, boundaryWorkspace, { bootstrapEmpty: true });
  assert.deepEqual(receipt.history, upgradedReceipt.history);
  assert.notEqual(receipt.target, upgradedReceipt.target);
  const isolated = await connect(fresh);
  try { assert.equal((await isolated.query("SELECT count(*)::int AS n FROM pg_namespace WHERE nspname=ANY($1::text[])", [schemas])).rows[0].n, 3); }
  finally { await isolated.end(); }
});

test("preexisting role privilege drift fails closed, retains pending receipt and creates no namespaces", async () => {
  const fresh = await database();
  assert(ownedRoles.has("crest_worker"));
  await admin.query("ALTER ROLE crest_worker LOGIN");
  try {
    await assert.rejects(apply(fresh, `${ledgerRoot}-drift`, boundaryWorkspace, { bootstrapEmpty: true }), /MIGRATION_CLI_FAILED_REVIEW_REQUIRED/);
    await assert.rejects(apply(fresh, `${ledgerRoot}-drift`, boundaryWorkspace, { bootstrapEmpty: true }), /MIGRATION_PENDING_REVIEW_REQUIRED/);
    const isolated = await connect(fresh);
    try { assert.equal((await isolated.query("SELECT count(*)::int AS n FROM pg_namespace WHERE nspname=ANY($1::text[])", [schemas])).rows[0].n, 0); }
    finally { await isolated.end(); }
  } finally { await admin.query("ALTER ROLE crest_worker NOLOGIN"); }
});
