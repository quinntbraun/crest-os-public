# Production supplier original documents

This slice adopts the registered supplier original reservation/read/write/publication functions without changing their SQL, grants, financial rules or schema. Their `fictional` names and the `crest_finance_preview` command-role name are retained historical identifiers. Reviewed migration `20270102180000_fictional_supplier_payables.sql` enforces current business/session authority, `finance.post` recovery locking, current bill revision/document reference, unposted-bill eligibility, immutable operation receipts and append-only audit history. No fixture identity or environment bypass is introduced.

## Private web composition

The web profile declares `supplierOriginals`, with `finance` and `operationResolution`. It requires both the existing private finance block and a `supplierOriginals` storage/worker block. Finance must select `supplierPayableReview` and its existing `supplierBillDrafts`/`moneyChannels` dependencies. The original-upload availability header is derived from the actual composed supplier transport; a finance feature name alone cannot advertise it.

The storage/worker block has the same exact fields as the [receipt block](PRODUCTION_RECEIPT_WORKER.md): explicit fixed R2 account/bucket credentials, canonical worker HTTPS origin, pinned server leaf and absolute private client key/certificate/CA files. The fixed endpoint is `/v1/supplier-originals/verify`. Its versioned business/account/bucket binding has a distinct supplier purpose. Receipt/photo payloads, wrong endpoints/bindings and caller-supplied candidate metadata are refused.

The web adapter uses the distinct finance runtime login and closed `crest_finance_preview` role for reservation/read authorization. Its directory snapshots the business and request values before fresh session verification. Original upload/reconciliation/preview mechanics remain the existing receipt-backed supplier workflow. Browser uploads use the bounded same-origin relay, file CSRF, session admission and private storage checks. No cloud credentials, publication login or decoder reaches the browser.

## Separate worker

The worker authentication profile uses the existing production profile format, direct TLS, and exactly the base capability `operationResolution`. It contains no finance, receipt, photo or supplier storage block and no managed ingress. Its origin/listener identify the actual worker TLS service. The fixed supplier-worker composition grants the `finance`/`supplierOriginals` capability dependency for this business, but receives no finance application login and exposes no finance HTTP handler. Capabilities do not grant database role membership.

The private worker profile has exactly:

| Field | Value |
| --- | --- |
| `schemaVersion` | `1` |
| `authenticationProfileFile` | Absolute path to the worker authentication profile |
| `storage` | The same R2 account/bucket as web configuration, with explicit worker credentials |
| `imageId` | Accepted decoder's exact `sha256:` image identity |
| `clientCAFile` | Absolute CA file for the authorized web client certificate |
| `clientFingerprint` | Authorized client leaf SHA-256 fingerprint, lowercase hex without colons |
| `workerConnectionString` | Separate restricted login to the same PostgreSQL host/port/database |

The publication login can assume only existing `crest_supplier_bill_document_worker`, with explicit SET membership and no inheritance/admin option. Production checks the login and closed NOLOGIN/NOINHERIT command role, absence of other memberships and privileged flags, and verified database TLS. Encoded-equivalent usernames and another database are refused. The ordinary web process never receives this login or publication method. No new role/grant or migration is needed.

After complete release/target acceptance, the command is:

```
node server/supplier-worker.mjs --production-supplier-worker /absolute/private/supplier-worker.json
```

Use the same accepted source image and isolated pinned Linux decoder. As with receipts/photos, this requires a verified host with direct mutual TLS and the existing isolated Docker runtime; a forwarded certificate header cannot replace the peer certificate. Host/provider/funding remain unresolved and no service has been provisioned. Private profiles/keys stay outside Git, with Unix owner-only permissions and operator-managed Windows ACLs. Both entry and composition still refuse the actually unaccepted bundled release.

The worker re-verifies the real owner session with the existing finance freshness requirement, then checks recovery authority/current reservation before decoding and publishing. The response only confirms completion; the application re-reads the actual committed original state. Interrupted writes/replies preserve the original identity for reconciliation. Cancellation, shutdown cleanup and uncertain sandbox creation/cleanup retain the same closed behavior as the other document workers.

Focused constructor, parser, scope-sealing and real TLS tests prove those specific boundaries. They do not prove deployed MFA, R2 permissions, actual decoder hosting, posting correctness, full source exports or independently recoverable production backups. Those remain launch requirements; no real financial setup or records were created here.
