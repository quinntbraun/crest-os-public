import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { sha256 } from "../src/tooling/migrations.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFile(new URL(`../${path}`, import.meta.url));
const compatibility = JSON.parse((await read("release/compatibility.json")).toString("utf8"));
const imageId = process.env.CREST_IMAGE_ID ?? null;
if (imageId && !/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error("Invalid container image ID");
const manifest = {
  formatVersion: 1,
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  workingTreeDirty: Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim()),
  nodeVersion: process.versions.node,
  packageManager: JSON.parse((await read("package.json")).toString("utf8")).packageManager,
  lockfileSha256: sha256(await read("package-lock.json")),
  migrationRegistrySha256: sha256(await read("supabase/migration-checksums.json")),
  canonicalMaintenanceSha256: sha256(await read("docs/CANONICAL_MAINTENANCE.json")),
  toolchainSha256: sha256(await read("release/toolchain.json")),
  compatibility,
  containerImageId: imageId,
  distributionDigest: null,
  productionActivation: "blocked"
};
if (process.env.CI && (manifest.workingTreeDirty || !imageId)) {
  throw new Error("CI candidate must identify the tested image and have no modified/untracked source files");
}
const output = new URL("../.local/release/", import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL("build-manifest.json", output), JSON.stringify(manifest, null, 2) + "\n");
console.log("Candidate metadata written to .local/release/build-manifest.json; production activation remains blocked");
