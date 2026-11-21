# Historical field restore investigation

November 19, 2026. Reliability/recoverability work takes priority over further visual refinement. This is an unresolved verification failure, not an approved normalization change or release.

## Preserved published failure

Public source bacc465e3de32a50892e13bb724e5a567189700e, Phase1 run 44502711253 attempt 2: all 21 prerequisites succeed; Foundation job 135513861289 fails `npm run test:field-registered` (360/369 pass). The first relevant failure is `independent54 restoration preserves every row role grant function constraint and included source original`, with `SYNTHETIC_RECOVERY_RESTORE_FAILED:schema`. The helper compares restored rows before reaching schema comparison. Later failures include undefined access to the missing restored fixture and coverage refusals; their full causal relationship still needs verification. Subsequent Foundation checks, including container/native document-worker acceptance, do not become passed because earlier steps succeeded. Commercial and expense workflows pass.

The original comparison includes normalized schema/grants, not only rows or a subset of tables. Its existing treatment of random pg_dump restriction nonces and version-specific verified policy-role presentation remains unchanged. Do not broaden normalization, change a frozen profile, regenerate provenance, remove a requirement or blindly retry the CI job to obtain a green result.

## Focused original proof

`.local/design-field54-recovery-original-current` executes the entire original `field54-candidate.test.mjs` in isolated owned databases with the original assertions and deadlines. Result: 25/25 pass, zero skipped/cancelled, source unchanged and owned cleanup confirmed. It exercises independent schema54 restoration, every retained row/role/grant/function/constraint/source-original check, populated later upgrades, independent frozen restores and source/operation preservation. This is the focused file, not all 369 field cases or full release acceptance.

The recovery helper, original test file and package command are byte-unchanged between local 797afc7 (the published bacc tree's matching local source) and current db600ed. Local UI changes have not modified those checks. Passing locally does not identify the CI cause or prove a repair.

## Next diagnostic scope

Run the exact existing 25-file registered-field command under an explicitly instrumented, isolated local diagnostic. An ignored test-only preload observes schema-only pg_dump strings already passed into the original hash, retaining bounded schema text and hash/length/sequence metadata in an ignored local directory. It leaves hash inputs/results and original assertions unchanged. A self-check verifies string, incremental and binary SHA-256 results. No row dump, credential, request body, raw error or public artifact is part of this observation.

If the mismatch reproduces, inspect exact source/restored schema differences and determine whether it is a real schema/grant difference or a proven presentation issue. Any repair needs a regression and current uninstrumented native verification; observed/instrumented success alone is not release acceptance. If it does not reproduce, retain the failure as unresolved and investigate environment/order evidence rather than asserting a cause or cure.

Installed accepted schema 109 is unchanged. Complete original audit and approved V1 scope remain active; no real-data/finance/provider activation, new spending or waived backup/device/release gate is authorized. Actual business use remains not ready.

## Full observed local result

`.local/design-field54-schema-observed-current` finishes all 369 cases across the original 25-file field-registered command successfully, zero skipped/cancelled, unchanged source and owned cleanup. The explicitly instrumented observer retains 52 schema-hash observations across 25 unique schema-only files in ignored local storage. The CI mismatch does not reproduce, including in the complete group context. Original hash inputs/results, comparisons, role/grant/schema/migration checks and test deadlines are unchanged. This is diagnostic evidence, not a cause/cure or uninstrumented release acceptance. The original bacc Foundation failure remains preserved; do not call a later success its repair. Further environment/order evidence and fresh uninstrumented full native/container/release acceptance remain required before delivery.
