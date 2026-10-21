import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { sha256 } from "../src/tooling/migrations.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
// Explicit public-baseline transition; original private history is preserved separately.
const baseline = "34558ed3df4f339e45b8d1a012a2e2d1246e3546";
const originalManifest = execFileSync("git", ["show", `${baseline}:docs/CANONICAL_MANIFEST.json`], { cwd: root });
const currentManifest = await readFile(new URL("../docs/CANONICAL_MANIFEST.json", import.meta.url));
if (!originalManifest.equals(currentManifest)) throw new Error("Original canonical manifest must remain byte-for-byte unchanged");
const manifest = JSON.parse(currentManifest.toString("utf8"));
const maintenance = JSON.parse(await readFile(new URL("../docs/CANONICAL_MAINTENANCE.json", import.meta.url), "utf8"));
if (maintenance.baselineCommit !== baseline || maintenance.schemaVersion !== 1) throw new Error("Unexpected canonical maintenance baseline");
const changes = new Map(maintenance.amendments.map((entry) => [entry.name, entry]));
if (changes.size !== maintenance.amendments.length) throw new Error("Duplicate canonical amendment");
for (const entry of manifest.output_files) {
  const original = execFileSync("git", ["show", `${baseline}:docs/${entry.name}`], { cwd: root });
  if (sha256(original) !== entry.sha256 || original.length !== entry.bytes) throw new Error(`Baseline provenance mismatch: ${entry.name}`);
  const change = changes.get(entry.name);
  if (change && (change.originalSha256 !== entry.sha256 || change.originalBytes !== entry.bytes)) throw new Error("Amendment must identify original bytes");
  const bytes = await readFile(new URL(`../docs/${entry.name}`, import.meta.url));
  if (sha256(bytes) !== (change?.sha256 ?? entry.sha256) || bytes.length !== (change?.bytes ?? entry.bytes)) {
    throw new Error(`Undocumented canonical drift: ${entry.name}`);
  }
  if (change && !bytes.toString("utf8").includes(`Version: ${change.version} |`)) throw new Error(`Canonical version mismatch: ${entry.name}`);
  changes.delete(entry.name);
}
if (changes.size) throw new Error("Amendment references a document outside the original manifest");
console.log(`Canonical baseline and ${maintenance.amendments.length} explicit amendments verified`);
