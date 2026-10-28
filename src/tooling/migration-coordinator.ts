import { execFile } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, open, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join, resolve, toNamespacedPath } from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import { sha256, validateMigrationSet } from "./migrations.ts";
import type { MigrationRegistry } from "./migrations.ts";

const execute = promisify(execFile);
export const migrationLock = [8291, 2] as const;
export const cliVersion = "2.121.0";
class MigrationCoordinatorError extends Error {}
function safeFailure(error: unknown, fallback = "MIGRATION_FAILED_REVIEW_REQUIRED"): Error {
  // Intentionally omit raw child/database causes: they can include credentials or SQL.
  const message = error instanceof MigrationCoordinatorError ? error.message : fallback;
  return new MigrationCoordinatorError(message);
}
type History = { version: string; name: string; statementsSha256: string }[];
export type MigrationReceipt = {
  formatVersion: 1;
  attempt: string;
  target: string;
  sourceCommit: string;
  cliVersion: string;
  registry: MigrationRegistry;
  registrySha256: string;
  history: History;
  previousReceiptSha256: string | null;
};

// Deliberately no production/staging escape flag. Test databases are independently created
// by the integration harness; the ordinary application test database is not a migration target.
export function migrationTestTarget(environment: string | undefined, value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new MigrationCoordinatorError("INVALID_MIGRATION_TEST_TARGET"); }
  if (environment !== "test" || !["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "[::1]"].includes(url.hostname)
    || !/^\/crest_migrate_[a-f0-9]{16}$/.test(url.pathname)
    || !url.username || !url.password || url.search || url.hash) {
    throw new MigrationCoordinatorError("INVALID_MIGRATION_TEST_TARGET");
  }
  return url.toString();
}

export function assertHistory(registry: MigrationRegistry, history: History): void {
  if (history.length !== registry.migrations.length) throw new MigrationCoordinatorError("MIGRATION_HISTORY_REVIEW_REQUIRED");
  for (const [index, entry] of registry.migrations.entries()) {
    const row = history[index];
    if (!row || row.version !== entry.version || row.name !== entry.file.slice(15, -4)
      || !/^[a-f0-9]{64}$/.test(row.statementsSha256)) throw new MigrationCoordinatorError("MIGRATION_HISTORY_REVIEW_REQUIRED");
  }
}

export function validateReceipt(value: unknown, target: string): MigrationReceipt {
  // Receipts are a trusted release artifact, not a source of executable paths/SQL.
  const receipt = value as MigrationReceipt | undefined;
  if (!receipt || receipt.formatVersion !== 1 || receipt.target !== target
    || !/^[a-f0-9-]{36}$/.test(receipt.attempt) || !/^[a-f0-9]{40}$/.test(receipt.sourceCommit)
    || receipt.cliVersion !== cliVersion || !/^[a-f0-9]{64}$/.test(receipt.registrySha256)
    || !Array.isArray(receipt.history) || receipt.registry?.schemaVersion !== 1
    || !Array.isArray(receipt.registry.migrations)
    || (receipt.previousReceiptSha256 !== null && !/^[a-f0-9]{64}$/.test(receipt.previousReceiptSha256))) {
    throw new MigrationCoordinatorError("INVALID_MIGRATION_RECEIPT");
  }
  // Validate registry shape/order without pretending to recover original SQL from its hash.
  let last = "";
  for (const entry of receipt.registry.migrations) {
    if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(entry.file) || entry.version !== entry.file.slice(0, 14)
      || entry.version <= last || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new MigrationCoordinatorError("INVALID_MIGRATION_RECEIPT");
    last = entry.version;
  }
  assertHistory(receipt.registry, receipt.history);
  return receipt;
}

async function regularFile(path: string): Promise<Buffer> {
  if (!(await lstat(path)).isFile()) throw new MigrationCoordinatorError("MIGRATION_INPUT_MUST_BE_REGULAR_FILE");
  return readFile(path);
}

async function snapshot(workspace: string) {
  const registryBytes = await regularFile(join(workspace, "supabase/migration-checksums.json"));
  const registry: MigrationRegistry = JSON.parse(registryBytes.toString("utf8"));
  const files = new Map<string, Buffer>();
  for (const entry of await readdir(join(workspace, "supabase/migrations"), { withFileTypes: true })) {
    if (entry.name === ".gitkeep") continue;
    if (!entry.isFile() || !entry.name.endsWith(".sql")) throw new MigrationCoordinatorError("INVALID_MIGRATION_DIRECTORY_ENTRY");
    files.set(entry.name, await regularFile(join(workspace, "supabase/migrations", entry.name)));
  }
  try { validateMigrationSet(registry, files); }
  catch (error) { throw safeFailure(error, "MIGRATION_SOURCE_INTEGRITY_FAILED"); }
  return { registry, files, registryBytes, registrySha256: sha256(registryBytes) };
}

async function history(client: pg.Client): Promise<History> {
  const exists = await client.query("SELECT to_regclass('supabase_migrations.schema_migrations') AS relation");
  if (!exists.rows[0]?.relation) return [];
  const rows = await client.query("SELECT version, name, statements FROM supabase_migrations.schema_migrations ORDER BY version");
  return rows.rows.map((row) => {
    if (typeof row.version !== "string" || typeof row.name !== "string"
      || !Array.isArray(row.statements) || !row.statements.every((sql: unknown) => typeof sql === "string")) {
      throw new MigrationCoordinatorError("MIGRATION_HISTORY_REVIEW_REQUIRED");
    }
    return { version: row.version, name: row.name, statementsSha256: sha256(JSON.stringify(row.statements)) };
  });
}

async function syncDirectory(path: string): Promise<void> {
  // Windows file handles are flushed, but directory fsync is not available through Node.
  // This slice is a disposable-test tool, not a production durability certification.
  if (process.platform === "win32") return;
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function durableCreate(path: string, bytes: string): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  if ((await readFile(path, "utf8")) !== bytes) throw new MigrationCoordinatorError("MIGRATION_RECEIPT_READBACK_FAILED");
}

function childEnvironment(home: string, password: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  // Do not inherit provider tokens, project overrides, PG service/target settings or shell hooks.
  for (const key of ["PATH", "Path", "SystemRoot", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return { ...env, CI: "true", DO_NOT_TRACK: "1", SUPABASE_TELEMETRY_DISABLED: "1", SUPABASE_HOME: home, PGPASSWORD: password };
}

type Options = {
  environment: string | undefined;
  connectionString: string;
  workspace: string;
  ledgerRoot: string;
  cliPath: string;
  sourceCommit: string;
  bootstrapEmpty?: boolean;
  // Fault/barrier hooks exist only for tests; the command-line entry exposes none.
  beforeCli?: (guardPid: number) => Promise<void>;
  beforeReceipt?: () => Promise<void>;
};

export async function applyTestMigrations(options: Options): Promise<MigrationReceipt> {
  const connectionString = migrationTestTarget(options.environment, options.connectionString);
  if (!/^[a-f0-9]{40}$/.test(options.sourceCommit)) throw new MigrationCoordinatorError("EXACT_SOURCE_COMMIT_REQUIRED");
  const input = await snapshot(resolve(options.workspace));
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
  const abort = new AbortController();
  let connected = false;
  let locked = false;
  let alive = true;
  let activeChild: ChildProcess | undefined;
  let childClosed: Promise<void> | undefined;
  const lost = () => { alive = false; abort.abort(); };
  client.on("error", lost);
  client.on("end", lost);
  const guard = async () => {
    if (!alive) throw new MigrationCoordinatorError("MIGRATION_GUARD_LOST_REVIEW_REQUIRED");
    const result = await client.query(
      "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=$1::oid AND objid=$2::oid AND objsubid=2 AND granted) AS held",
      [...migrationLock]
    );
    if (!alive || !result.rows[0]?.held) throw new MigrationCoordinatorError("MIGRATION_GUARD_LOST_REVIEW_REQUIRED");
  };
  try {
    await client.connect(); connected = true;
    const lock = await client.query("SELECT pg_try_advisory_lock($1, $2) AS acquired", [...migrationLock]);
    if (!lock.rows[0]?.acquired) throw new MigrationCoordinatorError("MIGRATION_BUSY");
    locked = true;
    const identity = await client.query("SELECT system_identifier::text, current_database() AS database, (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid, pg_backend_pid() AS pid FROM pg_control_system()");
    const target = sha256(JSON.stringify([identity.rows[0].system_identifier, identity.rows[0].database, identity.rows[0].oid]));
    const ledger = join(resolve(options.ledgerRoot), target);
    await mkdir(ledger, { recursive: true, mode: 0o700 });
    const pendingPath = join(ledger, "pending.json");
    try { await lstat(pendingPath); throw new MigrationCoordinatorError("MIGRATION_PENDING_REVIEW_REQUIRED"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }

    let previous: MigrationReceipt | undefined;
    let previousHash: string | null = null;
    try {
      const head = JSON.parse((await regularFile(join(ledger, "HEAD.json"))).toString("utf8"));
      if (!/^[a-f0-9]{64}$/.test(head.sha256)) throw new MigrationCoordinatorError("INVALID_MIGRATION_RECEIPT_HEAD");
      const bytes = await regularFile(join(ledger, `${head.sha256}.json`));
      if (sha256(bytes) !== head.sha256) throw new MigrationCoordinatorError("MIGRATION_RECEIPT_CHECKSUM_MISMATCH");
      previous = validateReceipt(JSON.parse(bytes.toString("utf8")), target);
      previousHash = head.sha256;
      let newer = previous;
      const seen = new Set([previousHash]);
      while (newer.previousReceiptSha256 !== null) {
        const digest = newer.previousReceiptSha256;
        if (seen.has(digest)) throw new MigrationCoordinatorError("MIGRATION_RECEIPT_CHAIN_INVALID");
        seen.add(digest);
        const ancestorBytes = await regularFile(join(ledger, `${digest}.json`));
        if (sha256(ancestorBytes) !== digest) throw new MigrationCoordinatorError("MIGRATION_RECEIPT_CHECKSUM_MISMATCH");
        const ancestor = validateReceipt(JSON.parse(ancestorBytes.toString("utf8")), target);
        if (JSON.stringify(newer.registry.migrations.slice(0, ancestor.registry.migrations.length)) !== JSON.stringify(ancestor.registry.migrations)
          || JSON.stringify(newer.history.slice(0, ancestor.history.length)) !== JSON.stringify(ancestor.history)) {
          throw new MigrationCoordinatorError("MIGRATION_RECEIPT_CHAIN_INVALID");
        }
        newer = ancestor;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // A missing referenced receipt must never look like an empty ledger.
      const entries = await readdir(ledger);
      if (entries.length) throw safeFailure(error, "MIGRATION_RECEIPT_MISSING_REVIEW_REQUIRED");
    }
    if (previous && options.bootstrapEmpty) throw new MigrationCoordinatorError("MIGRATION_BOOTSTRAP_ALREADY_COMPLETED");
    if (!previous && !options.bootstrapEmpty) throw new MigrationCoordinatorError("EXPLICIT_EMPTY_BOOTSTRAP_REQUIRED");
    const oldHistory = await history(client);
    if (previous) {
      try { validateMigrationSet(input.registry, input.files, previous.registry); }
      catch (error) { throw safeFailure(error, "MIGRATION_APPLIED_BYTES_CHANGED_REVIEW_REQUIRED"); }
      if (JSON.stringify(oldHistory) !== JSON.stringify(previous.history)) throw new MigrationCoordinatorError("MIGRATION_HISTORY_REVIEW_REQUIRED");
    } else {
      if (oldHistory.length) throw new MigrationCoordinatorError("MIGRATION_HISTORY_REVIEW_REQUIRED");
      const existing = await client.query("SELECT count(*)::integer AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_' AND c.relkind IN ('r','p','v','m','S','f')");
      if (existing.rows[0]?.count !== 0) throw new MigrationCoordinatorError("MIGRATION_BOOTSTRAP_REQUIRES_EMPTY_DATABASE");
    }

    const attempt = randomUUID();
    await durableCreate(pendingPath, JSON.stringify({ attempt, target, sourceCommit: options.sourceCommit, registrySha256: input.registrySha256, previousReceiptSha256: previousHash }) + "\n");
    await syncDirectory(ledger);
    // Every operator must use the SAME protected ledger root. Pending survives any uncertain
    // apply, process death or lost guard, including a CLI commit with no completed receipt.
    // Windows mkdtemp rejects otherwise valid deep checkout paths without the
    // extended-length prefix. Other platforms retain the same absolute path.
    const staging = await mkdtemp(toNamespacedPath(join(ledger, "snapshot-")));
    await mkdir(join(staging, "supabase/migrations"), { recursive: true });
    const config = 'project_id = "crest-migration-test"\n[db]\nmajor_version = 17\n[db.seed]\nenabled = false\n';
    await writeFile(join(staging, "supabase/config.toml"), config, { mode: 0o400 });
    await writeFile(join(staging, "supabase/migration-checksums.json"), input.registryBytes, { mode: 0o400 });
    for (const [file, bytes] of input.files) await writeFile(join(staging, "supabase/migrations", file), bytes, { mode: 0o400 });
    const env = childEnvironment(join(staging, "cli-home"), decodeURIComponent(new URL(connectionString).password));
    await mkdir(env.SUPABASE_HOME!, { recursive: true });
    const version = await execute(options.cliPath, ["--version"], { env, timeout: 10000, maxBuffer: 128000 });
    if (version.stdout.trim() !== cliVersion) throw new MigrationCoordinatorError("MIGRATION_CLI_VERSION_MISMATCH");
    await options.beforeCli?.(Number(identity.rows[0].pid));
    if ((await snapshot(staging)).registrySha256 !== input.registrySha256) throw new MigrationCoordinatorError("MIGRATION_SNAPSHOT_CHANGED_REVIEW_REQUIRED");
    await guard();
    if (oldHistory.length < input.registry.migrations.length) {
      const cliUrl = new URL(connectionString);
      cliUrl.password = "";
      // This coordinator only accepts explicit loopback synthetic targets. The
      // pinned CLI otherwise requires TLS even when that local cluster has none.
      cliUrl.searchParams.set("sslmode", "disable");
      cliUrl.searchParams.set("lock_timeout", "3000");
      cliUrl.searchParams.set("statement_timeout", "30000");
      cliUrl.searchParams.set("application_name", `crest-migration-${attempt}`);
      // No linked project, role/seed/vault processing, shell execution or history repair.
      cliUrl.searchParams.set("connect_timeout", "5");
      const result = new Promise<void>((complete, fail) => {
        activeChild = execFile(options.cliPath, ["db", "push", "--db-url", cliUrl.toString(), "--workdir", staging, "--skip-vault", "--yes", "--agent", "no"], { env, timeout: 120000, maxBuffer: 128000, signal: abort.signal }, (error) => {
          if (error) fail(new MigrationCoordinatorError("MIGRATION_CLI_FAILED_REVIEW_REQUIRED"));
          else complete();
        });
        childClosed = new Promise<void>((closed) => activeChild!.once("close", () => closed()));
      });
      await result;
      await childClosed;
    }
    await guard();
    if ((await snapshot(staging)).registrySha256 !== input.registrySha256) throw new MigrationCoordinatorError("MIGRATION_SNAPSHOT_CHANGED_REVIEW_REQUIRED");
    const after = await history(client);
    assertHistory(input.registry, after);
    if (JSON.stringify(after.slice(0, oldHistory.length)) !== JSON.stringify(oldHistory)) throw new MigrationCoordinatorError("MIGRATION_HISTORY_REVIEW_REQUIRED");
    const current = await snapshot(resolve(options.workspace));
    if (current.registrySha256 !== input.registrySha256) throw new MigrationCoordinatorError("MIGRATION_SOURCE_CHANGED_REVIEW_REQUIRED");
    await options.beforeReceipt?.();
    await guard();
    const receipt: MigrationReceipt = { formatVersion: 1, attempt, target, sourceCommit: options.sourceCommit, cliVersion, registry: input.registry, registrySha256: input.registrySha256, history: after, previousReceiptSha256: previousHash };
    const bytes = JSON.stringify(receipt, null, 2) + "\n";
    const hash = sha256(bytes);
    await durableCreate(join(ledger, `${hash}.json`), bytes);
    const newHead = join(ledger, `head-${attempt}.tmp`);
    await durableCreate(newHead, JSON.stringify({ sha256: hash }) + "\n");
    await guard();
    await rename(newHead, join(ledger, "HEAD.json"));
    await syncDirectory(ledger);
    await guard();
    await unlink(pendingPath);
    await syncDirectory(ledger);
    return receipt;
  } catch (error) {
    // Never echo child output, URLs, passwords or raw SQL into public CI logs.
    throw safeFailure(error);
  } finally {
    // Do not release the serialization lock while a child may still be applying SQL.
    abort.abort();
    const forceStop = activeChild && childClosed ? setTimeout(() => { activeChild?.kill("SIGKILL"); }, 2000) : undefined;
    forceStop?.unref();
    await childClosed;
    if (forceStop) clearTimeout(forceStop);
    if (connected && locked && alive) await client.query("SELECT pg_advisory_unlock($1, $2)", [...migrationLock]).catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}
