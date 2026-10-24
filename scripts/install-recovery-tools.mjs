import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { sha256 } from "../src/tooling/migrations.ts";

const { age } = JSON.parse(await readFile(new URL("../release/toolchain.json", import.meta.url), "utf8"));
if (process.arch !== "x64" || !["linux", "win32"].includes(process.platform)) throw new Error("Unsupported recovery tool platform");
const windows = process.platform === "win32";
const name = `age-v${age.version}-${windows ? "windows-amd64.zip" : "linux-amd64.tar.gz"}`;
const response = await fetch(`https://github.com/FiloSottile/age/releases/download/v${age.version}/${name}`, { signal: AbortSignal.timeout(120000) });
if (!response.ok) throw new Error("Recovery tool download failed");
const bytes = Buffer.from(await response.arrayBuffer());
if (sha256(bytes) !== (windows ? age.windowsAmd64Sha256 : age.linuxAmd64Sha256)) throw new Error("Recovery tool checksum mismatch");
const directory = fileURLToPath(new URL("../.local/tools/recovery/", import.meta.url));
await mkdir(directory, { recursive: true });
const archive = `${directory}/${name}`;
await writeFile(archive, bytes);
if (windows) execFileSync("pwsh", ["-NoProfile", "-File", fileURLToPath(new URL("./unpack-tool.ps1", import.meta.url)), archive, directory], { stdio: "inherit" });
else execFileSync("tar", ["-xzf", archive, "-C", directory], { stdio: "inherit" });
for (const tool of ["age", "age-keygen"]) {
  const version = execFileSync(`${directory}/age/${tool}${windows ? ".exe" : ""}`, ["--version"], { encoding: "utf8" }).trim();
  if (version !== age.version && version !== `v${age.version}`) throw new Error("Recovery tool version mismatch");
}
console.log(`age ${age.version}: verified SHA-256 and both executable versions`);
