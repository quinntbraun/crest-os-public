import { execFileSync } from "node:child_process";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { sha256 } from "../src/tooling/migrations.ts";
import { hashRecoveryReleaseFile } from "../src/tooling/recovery-release-files.ts";
import { serverBuildIdentity } from "./server-build-identity.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFile(new URL(`../${path}`, import.meta.url));
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),workingTreeDirty=Boolean(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim());
const compatibility = JSON.parse((await read("release/compatibility.json")).toString("utf8"));
const imageId = process.env.CREST_IMAGE_ID ?? null;
if (imageId && !/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error("Invalid container image ID");
await mkdir(new URL('../.local/release/',import.meta.url),{recursive:true});
const signal=AbortSignal.timeout(900000);
async function archive(name){try{const digest=await hashRecoveryReleaseFile(fileURLToPath(new URL('../.local/release/'+name,import.meta.url)),signal);return{file:name,byteSize:digest.byteSize,sha256:digest.sha256};}catch{if(process.env.CI)throw Error('CI_RELEASE_ARCHIVE_REQUIRED');return null;}}
const imageArchive=await archive('crest-os-image.tar'),sourceArchive=await archive('crest-os-source.tar');
if(sourceArchive){const file=await open(new URL('../.local/release/'+sourceArchive.file,import.meta.url),'r');try{const prefix=Buffer.alloc(4096),result=await file.read(prefix,0,prefix.length,0);if(execFileSync('git',['get-tar-commit-id'],{cwd:root,input:prefix.subarray(0,result.bytesRead),encoding:'utf8'}).trim()!==sourceCommit)throw Error('RELEASE_SOURCE_ARCHIVE_REQUIRED');}finally{await file.close();}}
const manifest = {
  formatVersion: 2,
  sourceCommit,
  workingTreeDirty,
  nodeVersion: process.versions.node,
  packageManager: JSON.parse((await read("package.json")).toString("utf8")).packageManager,
  lockfileSha256: sha256(await read("package-lock.json")),
  migrationRegistrySha256: sha256(await read("supabase/migration-checksums.json")),
  canonicalMaintenanceSha256: sha256(await read("docs/CANONICAL_MAINTENANCE.json")),
  toolchainSha256: sha256(await read("release/toolchain.json")),
  compatibility,
  containerImageId: imageId,
  buildIdentity: await serverBuildIdentity(),
  distributionDigest: imageArchive?'sha256:'+imageArchive.sha256:null,
  imageArchive,
  sourceArchive,
  productionActivation: "blocked"
};
if (process.env.CI && (manifest.workingTreeDirty || !imageId || !imageArchive || !sourceArchive)) {
  throw new Error("CI candidate must identify the tested image, both recovery archives and clean source");
}
if(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()!==manifest.sourceCommit||Boolean(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim())!==manifest.workingTreeDirty)throw Error('RELEASE_SOURCE_CHANGED');
const output = new URL("../.local/release/", import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL("build-manifest.json", output), JSON.stringify(manifest, null, 2) + "\n");
console.log("Candidate metadata written to .local/release/build-manifest.json; production activation remains blocked");
