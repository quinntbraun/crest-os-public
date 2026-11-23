# Authenticated database, metadata and object retrieval

`createPinnedRecoveryArtifactRestore` runs on the separate restore host with the
offline age identity and protected workspace. It retrieves an exact versioned
vault receipt, verifies retention and ciphertext bytes, authenticates age, checks
the exact plaintext size/SHA and expected kind prefix, fsyncs a new exclusive
private output, and returns its path only after all checks pass. Input descriptors
are frozen before awaits. It does not receive a source database connection.

Kinds are bounded explicitly: database custom dump up to1GiB and PGDMP prefix;
metadata object up to8MiB and JSON object prefix; originals/quarantine up to25MiB.
Only quarantine may be empty. This does not widen user attachment validation,
permit arbitrary archive sizes or make unvalidated quarantine renderable. Kind
prefix is a basic format guard; higher-level schema/binding and independent
database/financial checks remain required before application.

The function streams into an exclusive0600 file in an existing private owned
workspace, with a closed child environment, pinned age version and bounded
deadline. Existing files are not replaced. Partial plaintext, owned retrieval
ciphertext and private process home are removed on failure; child processes and
writes are awaited. A retrieval destination becomes owned only after the vault
successfully creates/verifies it, so a refused preexisting path is not deleted.
The release-part reader uses that same ownership correction.

Metadata includes private configuration, role/table/financial inventory and
component indexes. Recovering those bytes does not validate their full semantic
schema or prove CI authorship. A malformed JSON object can still have the object
prefix and correct captured checksum; each versioned reader must enforce its
contract. Successful database retrieval does not apply SQL, create roles, change
sessions, restore objects, load images, render originals or start the application.
Every result retains `authenticated:true`, `applied:false`, `rendered:false` and
`completeBackup:false`. Higher-level incident/fresh-host authorization and full
restore/reconciliation acceptance stay mandatory.

The native release fixture recovers a real encrypted configuration through this
reader before the closed recipe/offline reconstruction checks. Wrong plaintext
hash and ciphertext tampering with a matching changed transport hash must remove
partial files without altering previous recovered outputs. Empty quarantine
recovers as raw bytes and refuses a metadata classification before retrieval.
The coordinated database fixture also retrieves its actual pg_dump artifact
through this implementation, checks the dump magic/full checksum and leaves it
unapplied. Real provider/off-laptop restore acceptance remains separate.

Native acceptance onaabca60 passes40 cases with unchanged tracked source and
awaited owned cleanup in `.local/recovery-artifact-restore138/result.json`.
This combines the25 reader/lease/coordinated-run cases and15 release/configuration/
artifact cases. The coordinated database dump is retrieved from its actual
versioned SDK receipt through this reader; the configuration likewise passes
authenticated retrieval before exact offline reconstruction. Wrong plaintext
hash and updated-transport-hash age tampering leave no partial output or process
home. Empty quarantine recovers as nonrendered raw bytes and metadata retyping
refuses before vault I/O. Existing independent database restore/control corruption,
lease-loss uncertainty, source-part authentication and paired distribution cases
remain passing. No combined retrieved-dump SQL application or full fresh-host
reopen is claimed by this scope.
