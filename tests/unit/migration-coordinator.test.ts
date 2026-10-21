import { describe, expect, it } from "vitest";
import { assertHistory, cliVersion, migrationTestTarget, validateReceipt } from "../../src/tooling/migration-coordinator.ts";
import type { MigrationReceipt } from "../../src/tooling/migration-coordinator.ts";
import { sha256 } from "../../src/tooling/migrations.ts";

const hash = sha256("synthetic");
const entry = { version: "20261021000000", file: "20261021000000_example.sql", sha256: hash };
const history = [{ version: entry.version, name: "example", statementsSha256: hash }];
const receipt: MigrationReceipt = {
  formatVersion: 1, attempt: "00000000-0000-4000-8000-000000000000", target: hash,
  sourceCommit: "a".repeat(40), cliVersion, registry: { schemaVersion: 1, migrations: [entry] },
  registrySha256: hash, history, previousReceiptSha256: null
};
const target = "postgresql://synthetic:synthetic@127.0.0.1:54322/crest_migrate_0123456789abcdef";

describe("controlled migration input and receipt boundaries", () => {
  it("allows explicitly named disposable databases in the test environment", () => {
    expect(migrationTestTarget("test", target)).toBe(target);
  });
  it.each([undefined, "local", "staging", "production"])("rejects environment %s", (env) => {
    expect(() => migrationTestTarget(env, target)).toThrow("INVALID_MIGRATION_TEST_TARGET");
  });
  it.each([
    target.replace("127.0.0.1", "db.example.com"), target.replace("127.0.0.1", "localhost"),
    target.replace("crest_migrate_0123456789abcdef", "crest_test"), target + "?host=db.example.com",
    target + "#fragment", "not a url", target.replace("synthetic:synthetic@", "synthetic@")
  ])("rejects target confusion without echoing the supplied URL", (value) => {
    expect(() => migrationTestTarget("test", value)).toThrow(/^INVALID_MIGRATION_TEST_TARGET$/);
  });
  it("accepts a receipt bound to its observed database and exact CLI history", () => {
    expect(validateReceipt(receipt, hash)).toEqual(receipt);
  });
  it("rejects a receipt from another database incarnation or CLI", () => {
    expect(() => validateReceipt(receipt, "b".repeat(64))).toThrow();
    expect(() => validateReceipt({ ...receipt, cliVersion: "0.0.0" }, hash)).toThrow();
  });
  it("rejects malformed source/checksum/version identities", () => {
    for (const patch of [{ sourceCommit: "main" }, { previousReceiptSha256: "../outside" }, { registrySha256: "bad" }]) {
      expect(() => validateReceipt({ ...receipt, ...patch }, hash)).toThrow();
    }
    expect(() => validateReceipt({ ...receipt, registry: { schemaVersion: 1, migrations: [entry, entry] } }, hash)).toThrow();
  });
  it("rejects extra, missing, renamed or malformed CLI history rows", () => {
    const registry = receipt.registry;
    expect(() => assertHistory(registry, [])).toThrow();
    expect(() => assertHistory(registry, [...history, ...history])).toThrow();
    expect(() => assertHistory(registry, [{ ...history[0]!, name: "other" }])).toThrow();
    expect(() => assertHistory(registry, [{ ...history[0]!, statementsSha256: "" }])).toThrow();
  });
});
