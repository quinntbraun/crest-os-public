import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const paths = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
if (!paths.length) throw new Error("Publication audit requires a tracked source tree");
const unsafePath = /(^|\/)(sources|private|backups|customer-data|production-data|\.local)(\/|$)|\.(csv|xlsx?|dump|backup|sqlite3?|db|pem|key|p12|pfx)$/i;
const emails = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
for (const path of paths) {
  if (unsafePath.test(path) || (/(^|\/)\.env/.test(path) && path !== ".env.example")) {
    throw new Error(`Private/data artifact requires explicit publication review: ${path}`);
  }
  if (!path.endsWith(".md") && path !== ".env.example") continue;
  const text = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  for (const match of text.matchAll(emails)) {
    if (!/@(?:[a-z0-9.-]+\.)?example\.(com|net|org)$/i.test(match[0])) {
      // Report location, not the possibly private value, in public CI logs.
      throw new Error(`Unreviewed contact address in ${path}`);
    }
  }
  if (path === "docs/CREST_CONTEXT.md" && Buffer.byteLength(text) > 2000) {
    throw new Error("Historical context must remain a short public boundary notice");
  }
}
console.log(`Publication boundary checked for ${paths.length} tracked files; manual privacy review and secret scanning remain required`);
