import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { sha256 } from "../src/tooling/migrations.ts";

const pins = JSON.parse(await readFile(new URL("../release/toolchain.json", import.meta.url), "utf8"));
const windows = process.platform === "win32";
if (process.arch !== "x64" || !["win32", "linux"].includes(process.platform)) throw new Error("Pinned tool downloads currently support Linux/Windows x64 only");
const toolRoot = new URL("../.local/tools/", import.meta.url);
await mkdir(toolRoot, { recursive: true });
const downloads = [
  { name: "gitleaks", version: pins.gitleaks.version, repository: "gitleaks/gitleaks", file: `gitleaks_${pins.gitleaks.version}_${windows ? "windows_x64.zip" : "linux_x64.tar.gz"}`, checksum: windows ? pins.gitleaks.windowsX64ZipSha256 : pins.gitleaks.linuxX64Sha256 },
  { name: "supabase", version: pins.supabaseCli.version, repository: "supabase/cli", file: `supabase_${pins.supabaseCli.version}_${windows ? "windows_amd64.zip" : "linux_amd64.tar.gz"}`, checksum: windows ? pins.supabaseCli.windowsAmd64ZipSha256 : pins.supabaseCli.linuxAmd64Sha256 }
];
for (const tool of downloads) {
  const response = await fetch(`https://github.com/${tool.repository}/releases/download/v${tool.version}/${tool.file}`, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Tool download failed: ${tool.name}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== tool.checksum) throw new Error(`Tool checksum mismatch: ${tool.name}`);
  const archive = fileURLToPath(new URL(tool.file, toolRoot));
  const destination = fileURLToPath(new URL(`${tool.name}/`, toolRoot));
  await writeFile(archive, bytes);
  await mkdir(destination, { recursive: true });
  if (windows) {
    // Literal paths are passed as positional arguments, never interpolated into shell code.
    const script = fileURLToPath(new URL("./unpack-tool.ps1", import.meta.url));
    execFileSync("pwsh", ["-NoProfile", "-File", script, archive, destination], { stdio: "inherit" });
  } else {
    execFileSync("tar", ["-xzf", archive, "-C", destination], { stdio: "inherit" });
  }
  const executable = fileURLToPath(new URL(`${tool.name}/${tool.name}${windows ? ".exe" : ""}`, toolRoot));
  const version = execFileSync(executable, [tool.name === "gitleaks" ? "version" : "--version"], { encoding: "utf8" }).trim();
  if (version !== tool.version) throw new Error(`Tool version mismatch: ${tool.name}`);
  console.log(`${tool.name} ${version}: verified SHA-256`);
}
