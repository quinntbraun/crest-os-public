import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { applyTestMigrations } from "../../src/tooling/migration-coordinator.ts";
import { testDatabaseConnection } from "../../src/tooling/test-database.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const base = testDatabaseConnection(process.env.CREST_ENV, process.env.CREST_TEST_DATABASE_URL);
const roles = ["crest_schema_owner", "crest_command_owner", "crest_web", "crest_worker", "crest_recovery"];
const relations = ["crest.businesses", "crest.memberships", "crest_private.actors", "crest_private.business_recovery_authorities", "crest_private.role_capabilities", "crest_private.identity_events"];
const admin = new pg.Client({ connectionString: base, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
const databases = new Set();
const ownedRoles = new Set();
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const cliPath = fileURLToPath(new URL(`../../.local/tools/supabase/supabase${process.platform === "win32" ? ".exe" : ""}`, import.meta.url));
let client;
let target;
let workspace;
let schema1;
let ledgerRoot;
let previousReceipt;
let currentReceipt;
let bootstrap;

async function database() {
  const name = `crest_migrate_${randomBytes(8).toString("hex")}`;
  assert.match(name, /^crest_migrate_[a-f0-9]{16}$/);
  await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
  databases.add(name);
  const url = new URL(base); url.pathname = `/${name}`;
  return url.toString();
}
async function connect(url = target) {
  const connection = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
  await connection.connect();
  return connection;
}
const apply = (url, ledger, source = root, extra = {}) => applyTestMigrations({ environment: "test", connectionString: url, ledgerRoot: ledger, workspace: source, cliPath, sourceCommit, ...extra });

before(async () => {
  await admin.connect();
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM pg_roles WHERE rolname=ANY($1::text[])", [roles])).rows[0].n, 0, "never adopt cluster roles outside this test suite");
  await mkdir(join(root, ".local/identity-integration"), { recursive: true });
  workspace = await mkdtemp(join(root, ".local/identity-integration/case-"));
  schema1 = join(workspace, "schema1");
  await mkdir(join(schema1, "supabase/migrations"), { recursive: true });
  const registry = JSON.parse(await readFile(join(root, "supabase/migration-checksums.json"), "utf8"));
  registry.migrations = registry.migrations.filter((m) => m.version <= "20261021031357");
  assert.equal(registry.migrations.length, 1);
  for (const m of registry.migrations) await writeFile(join(schema1, "supabase/migrations", m.file), await readFile(join(root, "supabase/migrations", m.file)));
  await writeFile(join(schema1, "supabase/migration-checksums.json"), JSON.stringify(registry) + "\n");
  target = await database();
  ledgerRoot = join(workspace, "ledger");
  try { previousReceipt = await apply(target, ledgerRoot, schema1, { bootstrapEmpty: true }); }
  finally {
    for (const r of (await admin.query("SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])", [roles])).rows) ownedRoles.add(r.rolname);
  }
  currentReceipt = await apply(target, ledgerRoot);
  client = await connect();
  bootstrap = (await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
});
after(async () => {
  await client?.end();
  for (const name of databases) {
    assert.match(name, /^crest_migrate_[a-f0-9]{16}$/);
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  for (const role of ownedRoles) { assert(roles.includes(role)); await admin.query(`DROP ROLE "${role}"`); }
  await admin.end();
});
async function transaction(body) {
  await client.query("BEGIN");
  try { await body(); }
  finally { await client.query("ROLLBACK"); }
}
async function denied(sql, values = [], code = "23514") {
  await client.query("SAVEPOINT expected_denial");
  try { await assert.rejects(client.query(sql, values), (e) => e.code === code); }
  finally { await client.query("ROLLBACK TO SAVEPOINT expected_denial"); }
}
async function actor(connection = client, subject = randomUUID()) {
  return (await connection.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic owner','https://auth.example.com/auth/v1',$1,$2,$2,'manual') RETURNING id", [subject, bootstrap])).rows[0].id;
}
async function business(owner, connection = client, recovery = true) {
  const id = (await connection.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic business','America/Indiana/Indianapolis',$1,$1,'manual') RETURNING id", [owner])).rows[0].id;
  await membership(id, owner, owner, connection);
  if (recovery) await connection.query("INSERT INTO crest_private.business_recovery_authorities(business_id,created_by,updated_by,origin) VALUES($1,$2,$2,'manual')", [id, owner]);
  return id;
}
async function membership(businessId, owner, creator, connection = client) {
  return (await connection.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$3,$3,'manual') RETURNING id", [businessId, owner, creator])).rows[0].id;
}

test("schema1 upgrades without rewriting CLI history; schema2 starts with no real owner or tenant", async () => {
  assert.equal(previousReceipt.history.length, 1);
  assert.equal(currentReceipt.history.length, 2);
  assert.deepEqual(currentReceipt.history.slice(0, 1), previousReceipt.history);
  assert.deepEqual((await apply(target, ledgerRoot)).history, currentReceipt.history);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM crest.businesses")).rows[0].n, 0);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM crest_private.actors WHERE kind='owner'")).rows[0].n, 0);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM crest.memberships")).rows[0].n, 0);
  const capabilities = (await client.query("SELECT capability FROM crest_private.role_capabilities ORDER BY capability")).rows.map((r) => r.capability);
  assert.deepEqual(capabilities, ["crm.manage", "export.bulk", "finance.post", "identity.manage", "identity.read"]);
  assert(!capabilities.some((c) => c.startsWith("recovery.")), "ordinary owner mapping cannot grant incident authority");
});

test("all real identity relations force RLS; owners, grants and helper functions remain closed", async () => {
  const tables = await client.query("SELECT c.oid::regclass::text AS name,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('crest','crest_private','crest_commands') AND c.relkind IN ('r','p') ORDER BY name");
  assert.deepEqual(tables.rows.map((r) => r.name).sort(), [...relations].sort());
  for (const r of tables.rows) { assert(r.relrowsecurity && r.relforcerowsecurity, r.name); assert.equal(r.owner, "crest_schema_owner"); }
  const grants = await client.query("SELECT c.relname,a.grantee FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE n.nspname IN ('crest','crest_private') AND a.grantee<>c.relowner");
  assert.deepEqual(grants.rows, []);
  const functions = await client.query("SELECT p.proname,p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) AS owner,p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('crest','crest_private','crest_commands')");
  assert.equal(functions.rowCount, 4);
  for (const f of functions.rows) {
    assert.equal(f.owner, "crest_schema_owner"); assert.equal(f.prosecdef, false);
    assert.deepEqual(f.proconfig, ["search_path=pg_catalog, pg_temp"]);
    for (const role of ["crest_web","crest_command_owner","crest_worker","crest_recovery","anon","authenticated","service_role"]) assert.equal((await client.query("SELECT has_function_privilege($1,$2::oid,'EXECUTE') AS allowed", [role, f.oid])).rows[0].allowed, false);
  }
  await transaction(async () => {
    await client.query("SET LOCAL ROLE crest_schema_owner");
    for (const relation of relations) assert.equal((await client.query(`SELECT count(*)::int AS n FROM ${relation}`)).rows[0].n, 0);
    await client.query("RESET ROLE; SET LOCAL ROLE crest_web; SET LOCAL crest.business_id='00000000-0000-4000-8000-000000000001'");
    for (const relation of relations) await denied(`SELECT * FROM ${relation}`, [], "42501");
  });
});

test("provider subject pair is unique and immutable, with no email or first-login ownership", async () => transaction(async () => {
  const subject = randomUUID();
  const owner = await actor(client, subject);
  await denied("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Duplicate','https://auth.example.com/auth/v1',$1,$2,$2,'manual')", [subject, bootstrap], "23505");
  await denied("UPDATE crest_private.actors SET auth_user_id=$1,version=version+1 WHERE id=$2", [randomUUID(), owner], "55000");
  await denied("INSERT INTO crest_private.actors(kind,display_label,created_by,updated_by,origin) VALUES('owner','Unbound',$1,$1,'manual')", [bootstrap]);
  await denied("INSERT INTO crest_private.actors(kind,display_label,created_by,updated_by,origin) VALUES('system','Unnamed system',$1,$1,'system')", [bootstrap]);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM crest.memberships WHERE actor_id=$1", [owner])).rows[0].n, 0);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='crest_private' AND table_name='actors' AND column_name ILIKE '%email%'")).rows[0].n, 0);
}));

test("two tenants retain same-business creator/updater provenance and reject foreign memberships", async () => transaction(async () => {
  const a = await actor(); const b = await actor();
  const tenantA = await business(a); const tenantB = await business(b);
  await client.query("SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED");
  await denied("UPDATE crest.memberships SET business_id=$1,version=version+1 WHERE business_id=$2", [tenantB, tenantA], "55000");
  // Test the deferred composite FK, not just immediate boundary validation.
  await client.query("SAVEPOINT foreign_actor");
  await client.query("UPDATE crest.businesses SET updated_by=$1,version=version+1 WHERE id=$2", [b, tenantA]);
  await assert.rejects(client.query("SET CONSTRAINTS ALL IMMEDIATE"), (e) => e.code === "23503");
  await client.query("ROLLBACK TO SAVEPOINT foreign_actor");
  await denied("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'employee',$3,$3,'manual')", [tenantA,b,a]);
  await denied("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$3,$3,'manual')", [tenantA,bootstrap,a]);
}));

test("last live owner, recovery root, version and timezone constraints fail atomically", async () => transaction(async () => {
  const owner = await actor(); const tenant = await business(owner);
  await client.query("SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED");
  for (const sql of ["UPDATE crest.memberships SET active=false,version=version+1 WHERE business_id=$1", "UPDATE crest_private.actors SET disabled_at=clock_timestamp(),version=version+1 WHERE id=$1"]) {
    await client.query("SAVEPOINT last_owner");
    await client.query(sql, [sql.includes("memberships") ? tenant : owner]);
    await assert.rejects(client.query("SET CONSTRAINTS ALL IMMEDIATE"), (e) => e.code === "23514" && e.message === "CREST_LAST_ACTIVE_OWNER");
    await client.query("ROLLBACK TO SAVEPOINT last_owner");
  }
  await denied("UPDATE crest.businesses SET legal_name='Stale' WHERE id=$1", [tenant]);
  await denied("UPDATE crest.businesses SET timezone='Mars/Olympus',version=version+1 WHERE id=$1", [tenant]);
  await denied("UPDATE crest.businesses SET currency='EUR',version=version+1 WHERE id=$1", [tenant]);
  await client.query("SAVEPOINT missing_recovery");
  await business(owner, client, false);
  await assert.rejects(client.query("SET CONSTRAINTS ALL IMMEDIATE"), (e) => e.message === "CREST_RECOVERY_AUTHORITY_REQUIRED");
  await client.query("ROLLBACK TO SAVEPOINT missing_recovery");
  const state = (await client.query("SELECT r.writes_enabled,r.active_epoch,a.current_security_epoch FROM crest_private.business_recovery_authorities r JOIN crest.memberships m USING(business_id) JOIN crest_private.actors a ON a.id=m.actor_id WHERE r.business_id=$1", [tenant])).rows[0];
  assert.equal(state.writes_enabled, false); assert.notEqual(state.active_epoch, state.current_security_epoch);
}));

test("identity mutations reject snapshot isolation that would invalidate the owner-lock proof", async () => {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
  try { await assert.rejects(actor(), (e) => e.message === "CREST_IDENTITY_ISOLATION_REQUIRED"); }
  finally { await client.query("ROLLBACK"); }
});

test("identity changes append reconstructable history, hashes and operation attribution in the same transaction", async () => transaction(async () => {
  const owner = await actor(); const tenant = await business(owner); const operation = randomUUID();
  await client.query("UPDATE crest.businesses SET legal_name='Synthetic renamed',version=version+1,operation_id=$1 WHERE id=$2", [operation,tenant]);
  const events = (await client.query("SELECT * FROM crest_private.identity_events WHERE entity_id=$1 ORDER BY entity_version", [tenant])).rows;
  assert.equal(events.length, 2); assert.deepEqual(events.map((e) => e.action), ["INSERT","UPDATE"]);
  assert.equal(events[1].created_by, owner); assert.equal(events[1].operation_id, operation);
  assert.equal(events[1].payload.before.legal_name, "Synthetic business"); assert.equal(events[1].payload.after.legal_name, "Synthetic renamed");
  assert.equal((await client.query("SELECT count(*)::int AS n FROM crest_private.identity_events WHERE event_hash<>encode(sha256(convert_to(payload::text,'UTF8')),'hex') OR payload->>'id'<>id::text OR payload->>'entityId'<>entity_id::text")).rows[0].n, 0);
  const count = (await client.query("SELECT count(*)::int AS n FROM crest_private.identity_events")).rows[0].n;
  await denied("UPDATE crest.businesses SET legal_name='Rejected stale change' WHERE id=$1", [tenant]);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM crest_private.identity_events")).rows[0].n, count);
}));

test("future unlisted secret fields never enter identity history", async () => transaction(async () => {
  await client.query("ALTER TABLE crest_private.actors ADD COLUMN fixture_secret text DEFAULT 'synthetic-omit-from-history'");
  const owner = await actor();
  const payload = (await client.query("SELECT payload FROM crest_private.identity_events WHERE entity_id=$1", [owner])).rows[0].payload;
  assert.equal(payload.after.fixture_secret, undefined);
  assert(!JSON.stringify(payload).includes("synthetic-omit-from-history"));
}));

test("identity roots, permission mappings and history cannot be deleted/truncated or history edited", async () => transaction(async () => {
  const owner = await actor(); await business(owner);
  // Resolve deferred provisioning events so TRUNCATE reaches the retained-history
  // trigger itself, rather than PostgreSQL's earlier pending-event prohibition.
  await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  for (const relation of relations) {
    await denied(`DELETE FROM ${relation}`, [], "55000");
    await denied(`TRUNCATE ${relation} CASCADE`, [], "55000");
  }
  await denied("UPDATE crest_private.role_capabilities SET capability='identity.read'", [], "55000");
  await denied("UPDATE crest_private.identity_events SET event_hash=repeat('0',64)", [], "55000");
}));

async function waitForBlock(connection) {
  const pid = (await connection.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  return async () => {
    const deadline = Date.now()+3000;
    while (Date.now()<deadline) {
      if ((await admin.query("SELECT wait_event_type='Lock' AS blocked FROM pg_stat_activity WHERE pid=$1", [pid])).rows[0]?.blocked) return;
      await delay(20);
    }
    assert.fail("the competing identity change must actually wait on the database lock");
  };
}
async function race(disableActor) {
  await client.query("BEGIN");
  const a = await actor(); const b = await actor(); const tenant = await business(a);
  await membership(tenant,b,a); await client.query("COMMIT");
  const first = await connect(); const second = await connect();
  try {
    await first.query("BEGIN"); await second.query("BEGIN");
    const blocked = await waitForBlock(second);
    await first.query(disableActor ? "UPDATE crest_private.actors SET disabled_at=clock_timestamp(),version=version+1 WHERE id=$1" : "UPDATE crest.memberships SET active=false,version=version+1 WHERE business_id=$1 AND actor_id=$2", disableActor ? [a] : [tenant,a]);
    const pending = second.query("UPDATE crest.memberships SET active=false,version=version+1 WHERE business_id=$1 AND actor_id=$2", [tenant,b]).then(() => null, (e) => e);
    await blocked(); await first.query("COMMIT"); assert.equal(await pending, null);
    await assert.rejects(second.query("COMMIT"), (e) => e.message === "CREST_LAST_ACTIVE_OWNER");
    const count = await client.query("SELECT count(*)::int AS n FROM crest.memberships m JOIN crest_private.actors a ON a.id=m.actor_id WHERE m.business_id=$1 AND m.active AND a.disabled_at IS NULL", [tenant]);
    assert.equal(count.rows[0].n, 1);
  } finally {
    await first.query("ROLLBACK"); await second.query("ROLLBACK"); await first.end(); await second.end();
  }
}
test("concurrent owner deactivations cannot both remove the last active owner", async () => race(false));
test("actor disable serializes against owner membership removal", async () => race(true));

test("a new membership waits for concurrent actor disable and cannot create an ownerless business", async () => {
  const owner = await actor();
  const first = await connect(); const second = await connect();
  try {
    await first.query("BEGIN; SET LOCAL lock_timeout='3s'"); await second.query("BEGIN; SET LOCAL lock_timeout='3s'");
    const blocked = await waitForBlock(second);
    await first.query("UPDATE crest_private.actors SET disabled_at=clock_timestamp(),version=version+1 WHERE id=$1", [owner]);
    const tenant = (await second.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic race','UTC',$1,$1,'manual') RETURNING id", [owner])).rows[0].id;
    const pending = membership(tenant,owner,owner,second).then(() => null, (e) => e);
    await blocked(); await first.query("COMMIT"); assert.equal(await pending, null);
    await second.query("INSERT INTO crest_private.business_recovery_authorities(business_id,created_by,updated_by,origin) VALUES($1,$2,$2,'manual')", [tenant,owner]);
    await assert.rejects(second.query("COMMIT"), (e) => e.message === "CREST_LAST_ACTIVE_OWNER");
  } finally { await first.query("ROLLBACK"); await second.query("ROLLBACK"); await first.end(); await second.end(); }
});

test("fresh schema0 to schema2 preserves the same SQL history and closed access", async () => {
  const fresh = await database();
  const receipt = await apply(fresh, join(workspace,"fresh-ledger"), root, { bootstrapEmpty: true });
  assert.deepEqual(receipt.history, currentReceipt.history); assert.notEqual(receipt.target,currentReceipt.target);
});

test("unexpected owner default grants block identity migration before any sensitive table exists", async () => {
  const fresh = await database(); const ledger = join(workspace,"drift-ledger");
  await apply(fresh,ledger,schema1,{ bootstrapEmpty: true });
  const isolated = await connect(fresh);
  try {
    await isolated.query("ALTER DEFAULT PRIVILEGES FOR ROLE crest_schema_owner IN SCHEMA crest_private GRANT SELECT ON TABLES TO anon");
    await assert.rejects(apply(fresh,ledger), /MIGRATION_CLI_FAILED_REVIEW_REQUIRED/);
    assert.equal((await isolated.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('crest','crest_private') AND c.relkind='r'")).rows[0].n, 0);
    await assert.rejects(apply(fresh,ledger), /MIGRATION_PENDING_REVIEW_REQUIRED/);
  } finally { await isolated.end(); }
});
