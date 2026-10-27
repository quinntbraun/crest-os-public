# Reversible journal CSV construction

Unregistered schema43 proposal, 2026-10-26. `formatSourceExportJournalCsv`
produces six CSVs containing every114 source columns of jobs, attempts,
snapshots, intents, verifications and completions. Original request_text stays
in its source column as exact text, including whitespace, Unicode, escapes and
numeric JSON literals outside JavaScript's safe integer range. It is never
replaced with an opaque reference, omitted, parsed/reserialized or truncated.

Before formatting, replay the entire captured journal through the existing
closed reader-response collector in memory: all six metadata families, all
four original-text families, context/business/generation/time, declared counts,
aggregate bounds, source hashes and complete scoped chunk reconstruction. The
result must exactly equal the original serialized capture and consume every
page/chunk. This makes metadata changes, hidden duplicate keys, unknown columns,
extra/missing sources and forged counters fail the whole formatter. Replay
does not access PostgreSQL or authenticate the caller, nor independently prove
that an included snapshot came from a real database.

Each CSV has its closed source column order, fully quoted RFC4180 UTF8/CRLF
cells, a dictionary and an explicit per-cell formula escape map. Raw null is
unescaped backslash-N; literal backslashes are doubled. Prefix formula-leading
or literal-apostrophe text with exactly one recorded apostrophe. Versions and
expected_version remain decimal strings. Only named bounded integer columns
are converted by the independent reader. Original request_text and UTC
microsecond instants remain text. No spreadsheet type inference is permitted.

Job/attempt keys use their source id, snapshot/completion keys generation_id,
and intent/verification keys generation_id:part_id. No synthetic source id is
added. Escape maps use the complete same source key. All six CSVs are emitted,
including header-only files for zero-row families. Keep the original
journal_capture.json, source digest, binding, counts and per-file hashes in the
CSV manifest; include a readme describing decoding and remaining limitations.

The separate `readLogicalSourceExportCsv` entry point reuses the independent
RFC4180 parser with one/two closed UUID key columns and an explicit32MiB logical
file bound. The existing `readSourceExportCsv` retains its8MiB/UUID-id contract.
Neither reader imports a CSV formatter. Both require complete sorted unique
keys, exact headers, bounded row counts, matching formula evidence, paired
backslashes and explicit scalar types; no guessing of JSON or bigint values.

The private accessor is forJournalCsv, distinct from the current worker42.
Formatting is bounded at32MiB per logical file and64MiB for all files plus its
manifest, with at most100000 formula flags. The new logical-file container
splits large CSV/JSON into at-most4MiB physical text pieces under unchanged
8MiB plaintext/16MiB ciphertext crypto bounds. CSV output, original evidence
and their manifests all count toward the container's total. Expanded escaping
or duplicated evidence can legitimately exhaust a processing budget. Refuse
the whole result rather than omitting a column, row or original byte.

Twenty-nine formatter cases include a synthetic nonempty six-family114column
fixture, composite formula keys, exact text/null/unsafe-number preservation,
maximum12MiB completion through CSV and physical reconstruction, every stale
counter/missing/extra/corrupted source refusal and copied asynchronous binding.
Ten new independent-reader cases test composite keys and retain the old8MiB
bound; all42 preceding reader cases remain. No production records are used.

Two retained actual PostgreSQL cases now pass all six CSV/dictionary/escape
sets, original capture and CSV manifest through the logical-file container and
independent reconstruction. The first compares independently decoded CSV rows
with native PostgreSQL originals for every114fields; the second compares the
complete genuine maximum12MiB Ready text. The reader's key and integer schemas
are explicitly checked in those tests. The same208proposal/1191database/Auth
cases remain; fresh exact-source execution is required for this composition.

This proves included source consistency and reversible projection, not full
relational journal integrity, neutral schema reconstruction, whole-business
coverage, recoverable backup, capture provenance, owner authority, custody,
Ready or download authorization. Schema43 is not adopted; worker42 and current
nineteen-source CSV profile remain unchanged. Next: exact-source execution and
independent neutral PostgreSQL reconstruction/recovery compatibility before
explicit schema43 adoption and runtime composition.

Local verification passes all5267unit cases/152files, types, changed-source
lint and native syntax. The new maximum composition's test allowance is15s
because parallel suite CPU load exceeded the default5s; redundant scans were
removed. Product deadlines, all assertions and existing CLI test limits remain
unchanged. Logical-file predecessor51dde262 has no native/full acceptance yet;
capture predecessord732a637 retains independently accepted1191database/Auth.
Neither preceding source accepts the subsequent CSV composition.
