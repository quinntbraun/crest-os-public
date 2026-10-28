// Disposable CI-only migration fixtures. Never reuse a cluster containing these roles.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { applyTestMigrations } from "../../src/tooling/migration-coordinator.ts";
import { testDatabaseConnection } from "../../src/tooling/test-database.ts";

export async function migrationSandbox(testConnection=process.env.CREST_TEST_DATABASE_URL) {
  const root = fileURLToPath(new URL("../../",import.meta.url));
  const base = testDatabaseConnection(process.env.CREST_ENV,testConnection);
  const admin = new pg.Client({ connectionString:base,connectionTimeoutMillis:5000,statement_timeout:5000 });
  await admin.connect();
  const roles = ["crest_schema_owner","crest_command_owner","crest_web","crest_worker","crest_recovery","crest_auth_reader","crest_session_owner","crest_login_owner","crest_integrity_owner","crest_inventory_owner","crest_inventory","crest_cleanup_owner","crest_cleanup","crest_export_owner","crest_export","crest_identity_export_owner","crest_session_export_owner","crest_customer_owner","crest_customer_integrity_owner","crest_address_owner","crest_address_integrity_owner","crest_vehicle_owner","crest_vehicle_integrity_owner","crest_lead_source_owner","crest_lead_source_integrity_owner","crest_lead_owner","crest_lead_integrity_owner"];
  roles.push("crest_catalog_integrity_owner","crest_catalog_owner","crest_quote_integrity_owner","crest_quote_owner");
  try { assert.equal((await admin.query("SELECT count(*)::int AS n FROM pg_roles WHERE rolname=ANY($1::text[])",[roles])).rows[0].n,0,"refuse to adopt/drop other operators' roles"); }
  catch (error) { await admin.end(); throw error; }
  const databases = new Set(); const ownedRoles = new Set(); const connections = new Set();
  await mkdir(join(root,".local/session-integration"),{recursive:true});
  const workspace = await mkdtemp(join(root,".local/session-integration/case-"));
  const sourceCommit = execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
  const cliPath = join(root,`.local/tools/supabase/supabase${process.platform==="win32"?".exe":""}`);
  return {
    root,workspace,admin,
    async database() {
      const name = `crest_migrate_${randomBytes(8).toString("hex")}`;
      assert.match(name,/^crest_migrate_[a-f0-9]{16}$/);
      await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`); databases.add(name);
      const url = new URL(base); url.pathname=`/${name}`; return url.toString();
    },
    async connect(url) {
      const client = new pg.Client({connectionString:url,connectionTimeoutMillis:5000,statement_timeout:5000});
      await client.connect(); connections.add(client); return client;
    },
    async prefix(count) {
      assert(Number.isSafeInteger(count) && count>=0);
      const directory = join(workspace,`schema${count}`);
      await mkdir(join(directory,"supabase/migrations"),{recursive:true});
      const registry = JSON.parse(await readFile(join(root,"supabase/migration-checksums.json"),"utf8"));
      assert(count<=registry.migrations.length); registry.migrations=registry.migrations.slice(0,count);
      for(const m of registry.migrations) await writeFile(join(directory,"supabase/migrations",m.file),await readFile(join(root,"supabase/migrations",m.file)));
      await writeFile(join(directory,"supabase/migration-checksums.json"),JSON.stringify(registry)+"\n");
      return directory;
    },
    async apply(url,source=root,bootstrapEmpty=false) {
      try { return await applyTestMigrations({environment:"test",connectionString:url,workspace:source,ledgerRoot:join(workspace,"ledger"),cliPath,sourceCommit,bootstrapEmpty}); }
      finally { for(const r of (await admin.query("SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])",[roles])).rows) ownedRoles.add(r.rolname); }
    },
    async close() {
      for(const client of connections) await client.end();
      for(const name of databases) { assert.match(name,/^crest_migrate_[a-f0-9]{16}$/); await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`); }
      for(const role of ownedRoles) { assert(roles.includes(role)); await admin.query(`DROP ROLE "${role}"`); }
      await admin.end();
    }
  };
}
