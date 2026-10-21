import { describe, expect, it } from "vitest";
import { sha256, validateMigrationSet } from "../../src/tooling/migrations.ts";
import type { MigrationRegistry } from "../../src/tooling/migrations.ts";

const file = "20261020000000_registry.sql";
const sql = Buffer.from("select 1;\n");
const entry = { version: "20261020000000", file, sha256: sha256(sql) };
const registry: MigrationRegistry = { schemaVersion: 1, migrations: [entry] };
const files = new Map([[file, sql]]);

describe("migration integrity/release discipline", () => {
  it("accepts the empty foundation and a registered SQL migration", () => {
    expect(() => validateMigrationSet({ schemaVersion: 1, migrations: [] }, new Map())).not.toThrow();
    expect(() => validateMigrationSet(registry, files)).not.toThrow();
  });
  it("rejects changed bytes and missing files", () => {
    expect(() => validateMigrationSet(registry, new Map([[file, Buffer.from("select 2;")]]))).toThrow("checksum mismatch");
    expect(() => validateMigrationSet(registry, new Map())).toThrow("checksum mismatch");
  });
  it("rejects unregistered SQL and duplicate versions", () => {
    expect(() => validateMigrationSet({ schemaVersion: 1, migrations: [] }, files)).toThrow("Unregistered");
    expect(() => validateMigrationSet({ schemaVersion: 1, migrations: [entry, entry] }, files)).toThrow("unique increasing");
  });
  it("rejects path escapes and invalid version identity", () => {
    expect(() => validateMigrationSet({ schemaVersion: 1, migrations: [{ ...entry, file: "../registry.sql" }] }, files)).toThrow("filename/version");
    expect(() => validateMigrationSet({ schemaVersion: 1, migrations: [{ ...entry, version: "20261020000001" }] }, files)).toThrow("filename/version");
  });
  it("rejects deletion or a recomputed checksum for existing history", () => {
    expect(() => validateMigrationSet({ schemaVersion: 1, migrations: [] }, new Map(), registry)).toThrow("history is immutable");
    const changed = Buffer.from("select 2;\n");
    expect(() => validateMigrationSet({ schemaVersion: 1, migrations: [{ ...entry, sha256: sha256(changed) }] }, new Map([[file, changed]]), registry)).toThrow("history is immutable");
  });
  it("accepts append-only corrective migrations", () => {
    const next = { version: "20261020000001", file: "20261020000001_corrective.sql", sha256: sha256(sql) };
    expect(() => validateMigrationSet({ schemaVersion: 1, migrations: [entry, next] }, new Map([...files, [next.file, sql]]), registry)).not.toThrow();
  });
});
