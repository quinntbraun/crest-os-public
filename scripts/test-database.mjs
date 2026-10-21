import { readFile } from "node:fs/promises";
import pg from "pg";
import { testDatabaseConnection } from "../src/tooling/test-database.ts";
import { validateTapOutput } from "../src/tooling/tap.ts";

// This harness cannot connect to a non-loopback target or a database with another name.
const connectionString = testDatabaseConnection(process.env.CREST_ENV, process.env.CREST_TEST_DATABASE_URL);
const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5_000, statement_timeout: 10_000 });
let connected = false;
try {
  await client.connect();
  connected = true;
  await client.query("BEGIN");
  const lock = await client.query("SELECT pg_try_advisory_xact_lock(8291, 1) AS acquired");
  if (!lock.rows[0]?.acquired) throw new Error("Another database harness is active");
  const sql = await readFile(new URL("../tests/database/foundation.sql", import.meta.url), "utf8");
  const results = await client.query(sql);
  const output = (Array.isArray(results) ? results : [results])
    .flatMap((result) => result.rows)
    .flatMap((row) => Object.values(row))
    .filter((value) => typeof value === "string");
  try {
    console.log(validateTapOutput(output).join("\n"));
  } catch (error) {
    console.error(output.join("\n"));
    throw error;
  }
} finally {
  if (connected) await client.query("ROLLBACK").catch(() => undefined);
  await client.end();
}
