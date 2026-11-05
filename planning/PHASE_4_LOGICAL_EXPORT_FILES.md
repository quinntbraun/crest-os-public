# Bounded logical export files

Unregistered schema43 construction, 2026-10-26. A journal completion can retain
12MiB of original text; its captured base64 evidence is larger still. Neither
can be silently truncated or placed inside one existing8MiB physical encrypted
part. The proposed `crest.source-logical-files.v1` container separates logical
UTF8 files from their physical transport pieces without changing crypto limits.

`formatSourceLogicalFiles` accepts explicit named UTF8 text/CSV/JSON files and a
frozen business/generation/release/schema43 binding. It rejects paths, duplicate
names, unknown fields/types, NUL, malformed UTF8 and empty files. Each logical
file is at most32MiB. Split its original UTF8 bytes into at most4MiB physical
text pieces, moving a boundary backwards when necessary to keep a code point
intact. Never parse/rewrite CSV or JSON, normalize Unicode/whitespace, convert
numbers or infer cell types. This step therefore does not make a CSV file safe
to open in a spreadsheet; CSV producers still own their dictionaries/formula
escape maps. Original file types are retained on logical descriptors; physical
fragments are text, not individually complete CSV/JSON documents.

The JSON manifest records format/profile, business/generation/release/schema,
incomplete flags and original total bytes. Each ordered logical file records
its name/type/full UTF8 length/SHA256 and ordered physical descriptors with name,
offset/length/SHA256. Physical names are deterministic consecutive file/part
indices. Neither logical nor physical names are caller-supplied object keys.
Allow at most1024 physical pieces and64MiB combined original file bytes plus
manifest; manifest itself is at most4MiB. Any exhausted bound refuses the whole
container. No caller can raise limits. These are construction processing limits,
not a guarantee that every future whole-business export fits this profile.

`forLogicalFiles` is the private accessor; there is no `forServer` accessor for
the existing schema42 worker. JSON serialization refuses private plaintext.
The frozen result contains immutable strings and frozen physical descriptors.
Logical files can be recovered with ordinary UTF8 concatenation in manifest
order, followed by length/SHA256 verification. No proprietary compression,
database extension or paid service is needed.

`src/tooling/verify-source-logical-files.ts` is a separate decoder with no
formatter, collector, database or provider import. It closes every envelope and
descriptor shape, rejects duplicate/noncanonical manifest encodings, checks the
expected binding, every physical byte count/hash/UTF8, complete sequential file
membership and offsets, whole-file hashes/lengths and total bounds before
returning any file. Missing, extra, duplicate, reordered, corrupt or truncated
pieces fail the entire decode. Matching unkeyed hashes establish byte
consistency only. A trusted manifest, authenticated capture, journal relational
closure, encrypted custody, Ready and download authority remain separate gates.
completePortableExport and completeBackup remain false.

Thirty-nine focused cases cover exact text/CSV/JSON bytes with unsafe numeric
JSON literals, maximum12MiB and32MiB logical sources, UTF8 boundary splitting,
all input/manifest/scope/descriptor failures, exhausted total bounds, accessor
privacy and getters. Every part and manifest of a genuinely split file is also
encrypted/decrypted through the unchanged actual JWE codec and independently
reconstructed. A slow test assertion was replaced with exact Buffer.equals;
this changes neither product crypto nor the byte-equality assertion.

Two retained actual PostgreSQL capture cases now independently reconstruct the
portable journal evidence before comparing every original source field: small
complete six-table evidence and a genuine maximum12MiB Ready original. They
remain in the same208proposal cases; fresh exact-source execution is required.
These compositions prove portable original evidence, not journal CSV coverage,
neutral relational reconstruction, full encrypted worker integration or a
recoverable whole-business backup. The next step remains journal CSV and
independent neutral/recovery compatibility before explicit schema43 adoption.

Prerequisite captured sourced732a637/candidatef551db9c/run40433337313 has
independently passed1191database/Auth cases:651foundation/423provider/117Auth,
including all208proposal and three owned journal-collector cases. All negative
counts are zero. Full release acceptance remains separate. This proof does not
accept the subsequent logical-file composition changes. Local construction
checks pass5228unit cases/151files, types and changed-source lint; the two new
actual portable-file compositions still require fresh exact-source execution.
