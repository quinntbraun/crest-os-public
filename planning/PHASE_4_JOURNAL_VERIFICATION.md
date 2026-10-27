# Independent journal CSV verification

Unregistered schema 43 construction, 2026-10-26. This adds the missing offline
verification boundary between journal CSV formatting and a future combined
export. It adopts no migration, profile upgrade, runtime worker or download.

`src/tooling/verify-journal-csv.ts` imports neither the journal collector nor
its CSV writer, database adapter or provider. Its independent inventory closes
all six families and all 114 columns. It accepts the 20 reconstructed logical
files and separate journal CSV manifest, with an explicit business, generation,
release and schema 43 binding. The existing logical-file verifier must first
check physical pieces and reassemble the files. The existing schema 42 worker,
formatter, verifier and command-line profile remain unchanged.

Verification closes every file descriptor, name, content type, length and hash;
each dictionary's columns, key and bounded integer declarations; per-cell escape
map scope; source context, counters, pages and record ordering; original evidence
hashes; and complete scoped original-text reconstruction. It independently
decodes each CSV and compares every value to the corresponding source row.
Versions and original request text remain exact strings, including unsafe JSON
numeric literals, Unicode, whitespace, formulas and literal backslashes. No
original JSON request is parsed and rewritten. Extra, missing, duplicated,
unknown or coherently rehashed inconsistent files fail before rows are released.

The chunk assembler and CSV parser are shared byte/escaping readers, each
independently tested; the new verifier does not call the producer's collector
replay or derive its column/type expectations from producer dictionaries.
Successful private results expose `forJournalVerification`, refuse generic JSON
serialization and grant no execution or owner authority. The assurance remains
included source consistency only: a fully forged but mutually consistent source
cannot be authenticated by unkeyed hashes. Business relationship constraints,
source provenance, neutral relational reconstruction, database recovery and fresh
download authorization remain separate requirements. Completeness flags stay
false. Original 32 MiB logical, 64 MiB aggregate and physical crypto limits remain.

Validation: 5,302 local unit cases across 153 files pass, including 35 new
independent verification cases and the retained nonempty 114-column fixture.
Type checking and focused lint pass. The two existing native journal CSV capture
paths now additionally invoke this verifier after actual logical-file recovery,
comparing its results to their independently decoded CSVs. Fresh Linux execution
is required; inherited native proof does not accept changed source.

Prerequisite recovery source `cfddd94c` passed all 1,193 database/authentication
cases, including encrypted recovery. Its full release is checked independently.
Next: combine the 19 foundation/CRM projections and these six journal projections
under an explicit schema 43 manifest, independently verify their shared bindings,
and settle proposed profile/worker compatibility before canonical adoption.
The current worker must never relabel a schema 43 capture as schema 42.
