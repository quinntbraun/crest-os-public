import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
assert.equal(lock.lockfileVersion, 3, "Use the committed npm lockfile format");
for (const kind of ["dependencies", "devDependencies"]) {
  assert.deepEqual(pkg[kind], lock.packages[""][kind], "Package and lockfile declarations must match");
  for (const [name, version] of Object.entries(pkg[kind])) {
    assert.match(version, /^\d+\.\d+\.\d+$/, `Exact stable pin required: ${name}`);
  }
}
const licenses = new Set(["MIT", "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "CC0-1.0", "CC-BY-4.0", "Python-2.0", "BlueOak-1.0.0", "MPL-2.0", "(MIT OR CC0-1.0)", "(MIT OR Apache-2.0)", "(MIT AND Zlib)"]);
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path) continue;
  assert.match(entry.resolved, /^https:\/\/registry\.npmjs\.org\//, `Public registry only: ${path}`);
  assert.match(entry.integrity, /^sha512-/, `SHA-512 artifact integrity required: ${path}`);
  // Next's optional native image library bundles libvips; preserve its LGPL notices/source requirements.
  const reviewedLibvips = path.startsWith("node_modules/@img/sharp-") && new Set([
    "LGPL-3.0-or-later", "Apache-2.0 AND LGPL-3.0-or-later", "Apache-2.0 AND LGPL-3.0-or-later AND MIT"
  ]).has(entry.license);
  assert(licenses.has(entry.license) || reviewedLibvips, `Unreviewed dependency license: ${path}: ${entry.license}`);
}
console.log(`Exact direct pins, registry integrity and licenses verified: ${Object.keys(lock.packages).length - 1} locked packages`);
