# Proposed journal-aware source capture

Construction candidate, 2026-10-26. Registered schema remains42; journal
schema43 is unregistered. This completes neither portable export nor backup.

`createBusinessSourceJournalCollector` extends the existing owned connection,
closed export role, READ ONLY REPEATABLE READ transaction and30second deadline.
It reads all foundation, CRM and journal contexts in one initial SELECT.
Journal observation time must equal foundation observation time. Declared
aggregate record/original-byte limits are checked before any page. All six
journal metadata families and four original-text families use the existing
fixed parameterized export-only readers on that same connection. No additional
grants, source mutations, credentials, provider calls or schema changes occur.

The new bounded capture profile retains the existing8MiB metadata-source and
10000record limits across foundation, CRM and journal together. It separately
permits at most16MiB of original UTF8 journal text and24MiB of original chunk
JSON wire text. The total UTF8 size of the five retained serialized evidence
strings is limited to32MiB. These are hard construction limits, not caller
options. Envelopes and JSON escaping can cause refusal below a source limit.
Any exhausted bound discards the whole capture; no source row or text is skipped
or truncated. A larger future business needs a separately reviewed streaming
export design. The existing8MiB plaintext/16MiB ciphertext file limits are
unchanged; this in-memory source capture is not an uploadable physical part.

Metadata checks include the explicit114column inventory (request_text replaced
by its complete descriptor), business, record key/order, source hash, typed
versions/timestamps/IDs, exact count and per-family byte limits. Every original
uses the existing bounded assembler: matching token/business/kind/key, offsets,
canonical base64, chunk and complete SHA256, exact UTF8 and no NUL. Only one
original is assembled at a time; the owned byte buffer is disposed after
validation. Original context, canonical evidence and chunk JSON strings are
retained exactly. JSON strings are not claimed to be securely erased.

Only a confirmed COMMIT and subsequent deadline/cancellation check release the
frozen private result. Missing pages/chunks, malformed data, permission errors,
uncertain commit and late cancellation release no partial capture. Its accessor
is `forJournalServer`, deliberately distinct from the current schema42
`forServer` contract. It carries explicit sourceSchemaVersion43 and measured
metadata/original/wire/serialized-evidence counts. The two existing collector
factories retain their current output and limits.

This establishes included snapshot-byte consistency, not journal relational
reconstruction, ownership authentication, live lease, durable custody, Ready,
download authority or whole-business completeness. The current worker42,
nineteen CSV formatter, independent neutral restore and registered inventory
are unchanged. Next: exact-source native acceptance, then separate journal
format/independent reconstruction/recovery compatibility before schema43
adoption or runtime composition. Existing release gates still apply.

Tests cover exact wire preservation, maximum12MiB completion/24chunks, strict
context and aggregate budgets, corrupted or missing evidence, source binding,
private format separation and commit/cancellation failure. Three actual PG
cases extend the retained205proposal cases to208: all114fields compared to
native originals without source changes, genuine maximum completion capture,
and a blocked owned CRM snapshot surviving another device's Ready commit.
Those native cases require Linux CI execution; local unit tests are not a
substitute. No production data or deployment is involved.

Local construction checks: all5189unit cases/150files, changed-source lint,
types, canonical12amendments, registered42migrations and297locked dependencies
pass. These results do not accept the three new actual database cases.
