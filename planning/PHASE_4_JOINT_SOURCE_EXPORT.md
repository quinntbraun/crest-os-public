# Joint source and journal package

Unregistered schema 43 construction, 2026-10-27. This is a proposed format, not
an adopted migration, replacement worker or authorized owner download.

The joint profile is `crest.business-source-journal-bundle.v1`. It combines the
eight foundation and eleven CRM CSV projections with all six journal CSV
projections, their dictionaries, escape maps and original source evidence.
The physical container remains `crest.source-logical-files.v1`: at most 4 MiB
per UTF8 piece, 32 MiB per logical file and 64 MiB overall, including its manifest.
No encryption, capture or storage limit increases. Excess generations fail
without truncating rows or original text.

The source submanifest is explicitly `crest.business-source-projection.v1`
with sourceSchemaVersion 43. It reuses the existing source formatting and
independent verification rules through separate `forProjection43` entry points.
The forward formatter requires an explicitly schema 43 source; the ordinary
schema 42 capture has no such field and is refused. The old formatter, verifier,
command-line tool and worker keep their closed schema 42 profile and `forServer`
contracts. They do not accept or relabel the forward package. Original schema
42 manifests and their regression fixtures are unchanged.

`source_journal_manifest.json` binds the source and journal submanifest names
and exact hashes to one business, generation, release, observation and schema.
Its total record, metadata, original-text, wire and serialized-evidence counts
must agree with both component captures. All five serialized original source
envelopes remain within the collector's 32 MiB budget. Foundation/CRM metadata
keeps its existing 8 MiB cap. The source submanifest and journal submanifest
jointly account for every logical file; unclaimed, multiply claimed, missing or
extra files fail independent verification.

`formatBusinessSourceJournalBundle` snapshots its inputs before its first await,
checks both projections and counters, then formats the physical container.
`verifyBusinessSourceJournalBundle` imports no writer, collector, provider or
database adapter. It independently reconstructs every logical file, invokes the
independent source and journal verifiers, checks shared bindings and totals,
and releases private frozen rows only after every component passes. Its private
accessor is `forJournalBundleVerification`; the formatter uses `forJournalBundle`.
Neither offers the current worker's `forServer` interface. Included consistency
does not prove capture authenticity, full source relationships, current owner
authorization, Ready status, whole-business export or complete backup. All those
completeness/provenance claims remain false.

The later [joint worker revision](PHASE_4_JOINT_EXPORT_WORKER.md) explicitly
reconciles the unregistered SQL/job contract and worker plan with this joint
profile. It retains the existing schema 42 worker's closed contract. The revised
proposal and composition require fresh database/Auth/custody/recovery execution,
independent download composition and canonical adoption before use. This original
format slice itself changed no registered migration or SQL proposal.

Validation: all 5,331 local unit cases across 154 files pass, including 29 joint
cases, the retained schema 42 regressions, coherent rehash substitutions, counter
and cross-generation errors, and an exact maximum 12 MiB original. One initial
full-suite CLI case exceeded its unchanged deadline during concurrent checks;
the complete ordinary suite passed when run on its own. No existing timeout,
test assertion or global test configuration was changed. Types and focused lint
pass. Existing native source capture, maximum-size, neutral reconstruction and
encrypted recovery paths now verify the joint package (five invocations across
four retained cases); fresh Linux execution is required. Ancestor recovery source
cfddd94c has 1,193 database/authentication cases accepted independently; those
results do not accept this changed source. That ancestor's complete release run
40444080210 also passed independently, including build/browser/container and
source-bound artifacts. Owner request/download screens,
canonical schema 43 adoption and runtime worker composition remain unfinished.
