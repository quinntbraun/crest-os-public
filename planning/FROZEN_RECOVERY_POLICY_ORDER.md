# Frozen recovery policy-role ordering

Legacy schema53/54 backups can serialize a policy's role names in a different order after an independent restore. Controlled role-catalog relocation reproduces the old strict refusal while preserving rows, role attributes, relative role creation order and policy role membership.

The recovery verifier first extracts the original schema offline from the already authenticated archive and requires its original schema checksum to match the unchanged manifest. It then verifies each exact policy header and role set and compares every remaining schema byte. Only role-list presentation order is canonicalized. Changes to grants, owners, predicates, functions, columns, role sets or unsupported formatting still refuse. Source-database access and diagnostic caches are not acceptance authorities. Other versions retain their existing comparison.

Before the correction, the positive relocation probe refused0/1; the independent archive probe also refused0/1 and proved exact remaining schema equivalence. A normal original25/25 run is retained separately as non-reproduction. After the correction, the complete original25 cases plus forced53/54 regressions pass27/27 on c2d35b8e3abda5f0ec9a02ed8b67fd730a2cbe9d. Both new source databases are closed before restore. Tracked source stays unchanged and owned cluster cleanup succeeds. Full units9176/407, types and lint pass. See the retained local proof for exact log hashes.

Hosted747 remains failed at frozen53/54 recovery. Its differing schema bytes were unavailable, so the controlled mechanism and local fix require fresh full hosted confirmation. No frozen manifest, migration, business rule or production database was changed.
