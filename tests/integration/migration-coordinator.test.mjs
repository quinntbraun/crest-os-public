import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {createServer,connect as connectSocket} from 'node:net';
import pg from "pg";
import { applyTestMigrations } from "../../src/tooling/migration-coordinator.ts";
import { sha256 } from "../../src/tooling/migrations.ts";
import { testDatabaseConnection } from "../../src/tooling/test-database.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const base = testDatabaseConnection(process.env.CREST_ENV, process.env.CREST_TEST_DATABASE_URL);
const admin = new pg.Client({ connectionString: base, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const cliPath = fileURLToPath(new URL(`../../.local/tools/supabase/supabase${process.platform === "win32" ? ".exe" : ""}`, import.meta.url));
const owned = new Set();
before(async () => { await admin.connect(); });
after(async () => { assert.equal(owned.size, 0, "all owned disposable databases were removed"); await admin.end(); });

const first = "20261021000000_fixture.sql";
const second = "20261021000001_append.sql";
const sql = "CREATE TABLE public.coordinator_fixture(id integer PRIMARY KEY);\nINSERT INTO public.coordinator_fixture VALUES (1);\nCREATE TABLE public.coordinator_settings(lock_timeout text, statement_timeout text);\nINSERT INTO public.coordinator_settings SELECT current_setting('lock_timeout'), current_setting('statement_timeout');\n";
const appended = "INSERT INTO public.coordinator_fixture VALUES (2);\n";

async function withDatabase(body) {
  const name = `crest_migrate_${randomBytes(8).toString("hex")}`;
  assert.match(name, /^crest_migrate_[a-f0-9]{16}$/);
  await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
  owned.add(name);
  const url = new URL(base); url.pathname = `/${name}`;
  try { await body(url.toString(), name); }
  finally {
    // Names are locally generated and recorded only AFTER successful creation. Never enumerate
    // or drop a pre-existing database, even if it happens to match the test naming pattern.
    assert(owned.has(name));
    assert.match(name, /^crest_migrate_[a-f0-9]{16}$/);
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    owned.delete(name);
  }
}

async function fixture(connectionString, files = new Map([[first, sql]])) {
  await mkdir(join(root, ".local/migration-integration"), { recursive: true });
  const workspace = await mkdtemp(join(root, ".local/migration-integration/case-"));
  const directory = join(workspace, "supabase/migrations");
  await mkdir(directory, { recursive: true });
  const ledgerRoot = join(workspace, "ledger");
  const update = async (next) => {
    const migrations = [];
    for (const [file, text] of next) {
      await writeFile(join(directory, file), text);
      migrations.push({ version: file.slice(0, 14), file, sha256: sha256(text) });
    }
    await writeFile(join(workspace, "supabase/migration-checksums.json"), JSON.stringify({ schemaVersion: 1, migrations }) + "\n");
  };
  await update(files);
  const apply = (extra = {}) => applyTestMigrations({ environment: "test", connectionString, workspace, ledgerRoot, cliPath, sourceCommit, ...extra });
  const query = async (text, values) => {
    const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
    try { await client.connect(); return await client.query(text, values); } finally { await client.end(); }
  };
  const ledger = async () => {
    const names = (await readdir(ledgerRoot)).filter((name) => /^[a-f0-9]{64}$/.test(name));
    assert.equal(names.length, 1);
    return join(ledgerRoot, names[0]);
  };
  const pending = async () => JSON.parse(await readFile(join(await ledger(), "pending.json"), "utf8"));
  return { apply, query, update, ledger, pending };
}

test('a nondefault loopback port preserves the verified migrator identity through the real CLI', {timeout:45000},async()=>withDatabase(async url=>{
 const target=new URL(url),upstreamHost=target.hostname,upstreamPort=Number(target.port||5432),sockets=new Set();
 // Capture the destination before changing the client URL. Reading a mutable
 // URL inside this callback would send each new socket back into the proxy.
 const proxy=createServer(incoming=>{
  const upstream=connectSocket({host:upstreamHost,port:upstreamPort});
  sockets.add(incoming);sockets.add(upstream);incoming.pipe(upstream).pipe(incoming);
  incoming.on('error',()=>upstream.destroy());upstream.on('error',()=>incoming.destroy());
  incoming.on('close',()=>{sockets.delete(incoming);upstream.destroy();});
  upstream.on('close',()=>{sockets.delete(upstream);incoming.destroy();});
 });
 await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(0,'127.0.0.1',resolve);});
 try{
  const address=proxy.address();assert(address&&typeof address!=='string');assert.notEqual(address.port,upstreamPort);
  target.hostname='127.0.0.1';target.port=String(address.port);
  const f=await fixture(target.toString(),new Map([[first,'CREATE TABLE public.migrator_identity AS SELECT current_user::text AS name;\n']]));
  const receipt=await f.apply({bootstrapEmpty:true});assert.equal(receipt.history.length,1);
  assert.deepEqual((await f.query('SELECT name FROM public.migrator_identity')).rows,[{name:decodeURIComponent(target.username)}]);
 }
 finally{for(const socket of sockets)socket.destroy();await new Promise(resolve=>proxy.close(resolve));}
}));

test("CLI bootstrap, append, no-op and receipt chain preserve applied bytes and SQL history", { timeout: 45000 }, async () => withDatabase(async (url) => {
  const f = await fixture(url);
  await assert.rejects(f.apply(), /EXPLICIT_EMPTY_BOOTSTRAP_REQUIRED/);
  const one = await f.apply({ bootstrapEmpty: true });
  assert.equal(one.history.length, 1);
  assert.equal(one.previousReceiptSha256, null);
  assert.deepEqual((await f.query("SELECT * FROM public.coordinator_settings")).rows, [{ lock_timeout: "3s", statement_timeout: "30s" }]);
  await assert.rejects(f.apply({ bootstrapEmpty: true }), /MIGRATION_BOOTSTRAP_ALREADY_COMPLETED/);
  await f.update(new Map([[first, sql], [second, appended]]));
  const two = await f.apply();
  assert.equal(two.history.length, 2);
  assert.deepEqual(two.history[0], one.history[0]);
  const oneBytes = JSON.stringify(one, null, 2) + "\n";
  assert.equal(two.previousReceiptSha256, sha256(oneBytes));
  const three = await f.apply();
  assert.deepEqual(three.history, two.history);
  assert.deepEqual((await f.query("SELECT id FROM public.coordinator_fixture ORDER BY id")).rows, [{ id: 1 }, { id: 2 }]);
  await assert.rejects(f.pending(), { code: "ENOENT" });
}));

test("a recomputed checksum cannot rewrite an applied migration", { timeout: 45000 }, async () => withDatabase(async (url) => {
  const f = await fixture(url); await f.apply({ bootstrapEmpty: true });
  await f.update(new Map([[first, sql + "SELECT 9;\n"]]));
  await assert.rejects(f.apply(), /MIGRATION_APPLIED_BYTES_CHANGED_REVIEW_REQUIRED/);
  assert.deepEqual((await f.query("SELECT id FROM public.coordinator_fixture")).rows, [{ id: 1 }]);
}));

test("partial multi-file CLI failure leaves pending evidence and never automatically retries", { timeout: 45000 }, async () => withDatabase(async (url) => {
  const f = await fixture(url, new Map([[first, sql], [second, "SELECT 1/0;\n"]]));
  await assert.rejects(f.apply({ bootstrapEmpty: true }), /MIGRATION_CLI_FAILED_REVIEW_REQUIRED/);
  assert.equal((await f.query("SELECT count(*)::integer AS count FROM supabase_migrations.schema_migrations")).rows[0].count, 1);
  const pending = await f.pending();assert.equal(typeof pending.attempt, "string");
  const diagnostic = JSON.parse(await readFile(join(await f.ledger(), `failed-cli-${pending.attempt}.json`), "utf8"));
  assert.equal(diagnostic.outcome,"failed_review_required");assert.equal(diagnostic.rawOutputRetained,false);assert.deepEqual(diagnostic.publicErrorCodes,[]);
  assert(diagnostic.publicMigrationFiles.every(file=>[first,second].includes(file)));assert(!JSON.stringify(diagnostic).includes(url));
  await assert.rejects(f.apply({ bootstrapEmpty: true }), /MIGRATION_PENDING_REVIEW_REQUIRED/);
}));

test("SQL success followed by receipt failure is blocked from replay", { timeout: 45000 }, async () => withDatabase(async (url) => {
  const f = await fixture(url);
  await assert.rejects(f.apply({ bootstrapEmpty: true, beforeReceipt: async () => { await mkdir(join(await f.ledger(), "HEAD.json")); } }), /MIGRATION_FAILED_REVIEW_REQUIRED/);
  assert.equal((await f.query("SELECT count(*)::integer AS count FROM supabase_migrations.schema_migrations")).rows[0].count, 1);
  await f.pending();
  await assert.rejects(f.apply({ bootstrapEmpty: true }), /MIGRATION_PENDING_REVIEW_REQUIRED/);
}));

test("untrusted uppercase error text cannot escape through public failure diagnostics", { timeout: 45000 }, async () => withDatabase(async (url) => {
  const f = await fixture(url);
  await assert.rejects(f.apply({ bootstrapEmpty: true, beforeReceipt: async () => { throw new Error("MIGRATION_UNTRUSTED_SQL_MESSAGE"); } }), { message: "MIGRATION_FAILED_REVIEW_REQUIRED" });
  await f.pending();
}));

test("changed SQL history and a missing receipt fail closed", { timeout: 45000 }, async () => withDatabase(async (url) => {
  const f = await fixture(url); await f.apply({ bootstrapEmpty: true });
  await f.query("UPDATE supabase_migrations.schema_migrations SET statements=ARRAY['SELECT 9']");
  await assert.rejects(f.apply(), /MIGRATION_HISTORY_REVIEW_REQUIRED/);
  const ledger = await f.ledger();
  // A missing finalized artifact must not be treated as a fresh, empty ledger.
  await writeFile(join(ledger, "HEAD.json"), JSON.stringify({ sha256: "f".repeat(64) }));
  await assert.rejects(f.apply(), /MIGRATION_RECEIPT_MISSING_REVIEW_REQUIRED/);
}));

test("two coordinators cannot apply concurrently on a real PostgreSQL target", { timeout: 45000 }, async () => withDatabase(async (url) => {
  const f = await fixture(url);
  let enter; let release;
  const entered = new Promise((resolve) => { enter = resolve; });
  const barrier = new Promise((resolve) => { release = resolve; });
  const firstRun = f.apply({ bootstrapEmpty: true, beforeCli: async () => { enter(); await barrier; } });
  try {
    await entered;
    await assert.rejects(f.apply({ bootstrapEmpty: true }), /MIGRATION_BUSY/);
  } finally { release(); }
  await firstRun;
  assert.equal((await f.query("SELECT count(*)::integer AS count FROM public.coordinator_fixture")).rows[0].count, 1);
}));

test("source edits after staging cannot change executed bytes or produce a receipt", { timeout: 45000 }, async () => withDatabase(async (url) => {
  const f = await fixture(url);
  await assert.rejects(f.apply({ bootstrapEmpty: true, beforeCli: async () => { await f.update(new Map([[first, sql + appended]])); } }), /MIGRATION_SOURCE_CHANGED_REVIEW_REQUIRED/);
  assert.deepEqual((await f.query("SELECT id FROM public.coordinator_fixture")).rows, [{ id: 1 }]);
  await f.pending();
}));

test("loss of the guard during actual CLI execution retains pending evidence", { timeout: 45000 }, async () => withDatabase(async (url, database) => {
  const f = await fixture(url, new Map([[first, sql + "SELECT pg_sleep(10);\n"]]));
  let guardPid;
  let settled = false;
  const outcome = f.apply({ bootstrapEmpty: true, beforeCli: async (pid) => { guardPid = pid; } }).then(() => null, (error) => error).then((result) => { settled = true; return result; });
  const deadline = Date.now() + 20000;
  let running = false;
  while (!running && !settled && Date.now() < deadline) {
    // The pinned CLI's driver sets application_name=@effect/sql-pg. Observe the actual
    // sleeping backend in this uniquely owned database, not the requested client label.
    const result = await admin.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND pid<>$2 AND state='active' AND wait_event='PgSleep') AS running", [database, guardPid ?? 0]);
    running = result.rows[0].running;
    if (!running) await delay(25);
  }
  assert(running, "the real CLI must be executing before guard loss is injected");
  assert(Number.isInteger(guardPid));
  await admin.query("SELECT pg_terminate_backend($1)", [guardPid]);
  const error = await outcome;
  assert(error instanceof Error, "guard loss cannot be reported as success");
  await f.pending();
  await assert.rejects(f.apply({ bootstrapEmpty: true }), /MIGRATION_PENDING_REVIEW_REQUIRED/);
}));

test("bootstrap cannot adopt a database containing untracked application tables", { timeout: 45000 }, async () => withDatabase(async (url) => {
  const f = await fixture(url);
  await f.query("CREATE TABLE public.untracked_fixture(id integer)");
  await assert.rejects(f.apply({ bootstrapEmpty: true }), /MIGRATION_BOOTSTRAP_REQUIRES_EMPTY_DATABASE/);
}));
