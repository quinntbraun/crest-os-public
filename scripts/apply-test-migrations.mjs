import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { applyTestMigrations } from "../src/tooling/migration-coordinator.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
if (process.argv.slice(2).some((arg) => arg !== "--bootstrap-empty")) throw new Error("Only --bootstrap-empty is supported; no production target override exists");
if (execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim()) throw new Error("Migration source must be a clean reviewed Git checkout");
try {
  const receipt = await applyTestMigrations({
    environment: process.env.CREST_ENV,
    connectionString: process.env.CREST_MIGRATION_TEST_DATABASE_URL ?? "",
    workspace: root,
    ledgerRoot: fileURLToPath(new URL("../.local/migration-ledger/", import.meta.url)),
    cliPath: fileURLToPath(new URL(`../.local/tools/supabase/supabase${process.platform === "win32" ? ".exe" : ""}`, import.meta.url)),
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    bootstrapEmpty: process.argv.includes("--bootstrap-empty")
  });
  console.log(`Disposable-test migration receipt verified: ${receipt.attempt}; ${receipt.history.length} CLI history rows. Production remains disabled.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "MIGRATION_FAILED_REVIEW_REQUIRED");
  process.exitCode = 1;
}
