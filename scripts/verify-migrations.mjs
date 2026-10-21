import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { validateMigrationSet } from "../src/tooling/migrations.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const registry = JSON.parse(await readFile(new URL("../supabase/migration-checksums.json", import.meta.url), "utf8"));
const directory = new URL("../supabase/migrations/", import.meta.url);
const files = new Map();
for (const entry of await readdir(directory, { withFileTypes: true })) {
  if (entry.name === ".gitkeep") continue;
  if (!entry.isFile() || !entry.name.endsWith(".sql")) throw new Error("Migration directory accepts regular SQL files only");
  files.set(entry.name, await readFile(new URL(entry.name, directory)));
}
let previous;
const base = process.env.VERIFY_BASE_REF;
if (base) {
  if (!/^[a-f0-9]{40}$/.test(base)) throw new Error("Migration comparison requires an exact Git commit SHA");
  // Initial preparation commits have no migration registry; all later PRs must preserve it.
  const paths = execFileSync("git", ["ls-tree", "--name-only", base, "supabase/migration-checksums.json"], { cwd: root, encoding: "utf8" });
  if (paths.trim()) previous = JSON.parse(execFileSync("git", ["show", `${base}:supabase/migration-checksums.json`], { cwd: root, encoding: "utf8" }));
  else if (base !== "34558ed3df4f339e45b8d1a012a2e2d1246e3546") throw new Error("Missing migration registry on comparison base");
}
validateMigrationSet(registry, files, previous);
console.log(`Migration registry verified: ${files.size} ordered migrations`);
