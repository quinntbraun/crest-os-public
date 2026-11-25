# Private receipts in the fictional preview

Status: implemented locally; complete four-format worker acceptance and exact-source release acceptance pending. No production or real-data activation.

The design review found that the receipt screens were exercised with a configured test service, but the standard laptop and phone preview launchers did not compose a receipt runtime. The existing supplier-original worker did not grant receipt publication authority. This change connects the existing receipt workflow without changing accounting rules, database schema, grants, or historical expense records.

## Composition and separation

- Both synthetic launchers accept an explicit `--expense-receipts` flag. They require the existing verified `--posted-finance-export` profile to establish the source schema. This is a launcher setup fence, not a new financial prerequisite for receipt records.
- Supported registered source schemas are 49 through 121. An unknown later schema is refused until reviewed.
- Configuration lives in the private workspace's `expense-receipts/web.json` and `worker.json`. It must not be committed. The bucket is `crest-fictional-receipts-<workspace-id>` and must contain the existing matching workspace marker. Receipt and supplier-original buckets are distinct.
- The web profile exposes the bounded staging/object transport. The worker profile additionally requires test environment, the fixed business, `documentKind: expense-receipt`, matching storage identity, existing test authentication configuration and a digest-pinned validator image.
- Each publication forks the dedicated receipt worker. The web process sends only the fixed receipt operation IDs and current session credential over IPC. The child receives a restricted environment and is hidden on Windows. It authenticates and runs the existing receipt directory/workflow and isolated decoder. The web process receives no Docker socket or decoder implementation.
- Cancellation, timeout and child/process uncertainty retain the established stop-on-unknown behavior. Neither a failed worker nor a dropped HTTP reply is converted into a confirmed receipt. Normal recovery checks the original operation.
- The existing same-origin staging relay remains the phone upload path. No phone upload points at the laptop's loopback storage origin.

## Required verification

The worker-mode expense browser cases must pass in Chromium and WebKit using PNG, JPEG, PDF and HEIC originals. Each downloaded original must equal the uploaded bytes. The journey also verifies recovery after a dropped publication reply, preview privacy across pane changes, refusal of a supplier-purpose worker profile, retained uncertain-operation recovery, and unchanged expense amount/revision. The fixture checks unsupported schemas and workspace mismatch before opening the dispatcher.

CI retains all existing prerequisites and adds the isolated receipt journey after the candidate image is built. It requires two tests, zero failures/skips and both four-format markers. The receipt decoder log is retained with the candidate and on failure. The final local default-mode receipt cases and complete signed-in customer/vehicle journeys passed in Chromium and WebKit (four tests, zero failures/skips, stable source and owned database cleanup). Local isolated-worker PNG evidence was recorded on the preceding worker source. Neither result establishes the current four-format Linux worker or final-source release acceptance.

Installing the preview requires a new verified source/candidate and preserved upgrade evidence. Existing accepted schema109 source, profiles, photos, backups and launcher remain intact until that replacement passes. Configuration/key custody, off-laptop restore and physical iPhone acceptance remain separate requirements.

## November 17 security gate

The preceding design source's 19 prerequisite jobs passed in run44175392028, but Foundation checks stopped at dependency audit. GitHub advisory GHSA-fc5q-39xc-vjpf was updated November17 and affects picomatch through4.0.7. The public registry still reports4.0.7 as latest, and the advisory lists no patched version. This is an unresolved release gate. Do not exclude the advisory, lower the audit threshold, invent a patched version, replace integrity metadata, or treat the candidate as accepted. Continue independent implementation and local tests while investigating a compatible reviewed remedy or awaiting an upstream release.

Reference: https://github.com/advisories/GHSA-fc5q-39xc-vjpf . Package registry version checked directly with `npm view picomatch version`.
