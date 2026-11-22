# Production receipt worker connection

## Deployment decision and remaining gate

The web application retains its existing Render deployment and receives no Docker socket or decoder executable. Receipt validation has a separate credential-isolated entry point built from the same release, using the existing Linux sandbox and receipt workflow. Its private HTTPS RPC requires mutual TLS, a pinned worker leaf certificate and a pinned authorized client leaf certificate. This extends the existing isolated-dispatcher interface; it does not create a second customer-facing application, queue system or business-rule implementation.

This entry point requires an operator-verified Linux host with the fixed `/usr/bin/docker`, local `/var/run/docker.sock`, the exact pinned decoder image, adequate resource limits and direct TLS termination in the worker process. Ordinary managed edge HTTPS termination does not preserve this mutual-TLS contract. The worker host/provider, routing, price and funding remain unresolved; no paid host or platform migration has been selected or provisioned. Verify the actual environment before accepting the release. Local TLS transport tests are not deployed-decoder acceptance.

Both executables refuse an unaccepted bundled release before reading private profiles or opening a listener. `release/compatibility.json` remains blocked. Do not modify that gate merely to try these commands.

## Private web profile

Declare `expenseReceipts` together with its dependencies `expenses`, `customers` and `operationResolution`. The existing production profile then requires a `receipts` block with exactly:

| Field | Operator-owned value |
| --- | --- |
| `storage.accountId` | Exact 32-character lowercase hexadecimal R2 account ID |
| `storage.bucket` | Private receipt bucket |
| `storage.accessKeyId`, `storage.secretAccessKey` | Explicit bucket-scoped web credentials, never ambient credentials |
| `worker.origin` | Canonical HTTPS origin of the isolated worker, including a non-default port if applicable |
| `worker.serverFingerprint` | Worker leaf SHA-256 fingerprint: 64 lowercase hexadecimal characters without colons |
| `worker.keyFile`, `worker.certFile` | Absolute paths to the web client's private key and client certificate |
| `worker.caFile` | Absolute path to the CA trusted for the worker server certificate |

The endpoint is fixed to `/v1/receipts/verify`. No redirects, arbitrary bucket endpoint, browser-selected destination or TLS verification exception is accepted. The app relays bounded staging bytes to the fixed R2 HTTPS endpoint under the existing file CSRF/edit binding. No browser cloud credentials or public object URLs are added.

## Separate private worker profiles

Prepare a dedicated authentication profile using the existing production profile format. Its `capabilities` must be exactly `customers`, `operationResolution`, `expenses`; it must use direct `tls`, with no `ingress`, `finance` or `receipts` block. Its `origin` and `listen` describe the worker's actual HTTPS listener. Authentication uses the same actual owner/provider/session-token authority and business/database, under a separately provisioned restricted runtime login. No finance command role, supplier worker grant or browser-provided identity is required. The fixed worker composition adds only receipt authority for that same business after the real release gate passes.

Prepare a second private worker profile with exactly these fields:

| Field | Value |
| --- | --- |
| `schemaVersion` | `1` |
| `authenticationProfileFile` | Absolute path to that worker authentication profile |
| `storage` | The same R2 account/bucket as the web profile, with explicit worker credentials |
| `imageId` | Exact accepted decoder `sha256:` image identity; tags are refused |
| `clientCAFile` | Absolute path to the CA trusted for the web client certificate |
| `clientFingerprint` | Authorized web client leaf SHA-256 fingerprint, lowercase hex without colons |

Keep every profile and private key outside Git; Unix private profiles/keys require no group/other permission bits. Windows ACLs remain operator-managed and are not asserted by the loader. Keep the web client private key off the worker host; the worker receives its certificate authority and fingerprint. The web process receives no worker server key or Docker permission. Certificate rotation requires explicit reviewed profile changes and coordinated restart; unknown certificates fail closed.

After complete release acceptance and target verification, the worker command is:

```
node server/receipt-worker.mjs --production-receipt-worker /absolute/private/receipt-worker.json
```

If `PORT` exists, it must match the configured listener. No fixture mode, environment activation flag, public health route, forwarded-client-certificate header or automatic peer/certificate discovery is supported.

## Authority, failures and shutdown

The transport sends only the actual session credential, business/receipt/operation IDs and a versioned SHA-256 binding of business/account/bucket. Both ends derive that binding independently; mismatched storage configuration is refused before the workflow runs. Distinct bucket credentials are permitted. This catches configuration mismatch, but does not prove live bucket ownership or permissions.

TLS handshake, request headers, request bytes, response bytes, concurrency and operation time are bounded. Duplicate JSON names, extra candidate metadata, wrong Host/business/storage binding, browser cookies and untrusted certificates are refused. Only one validation runs at a time. Exceptions return fixed private failures; no credential, object key, SDK URL or stack is reflected. Cancellation reaches the active decoder. Shutdown waits for active handler cleanup before closing storage, subject to the executable's termination ceiling.

The worker independently rechecks the current real session and the recovery-fenced reservation, validates original bytes through the existing isolated decoder, uses immutable conditional object writes, verifies final hashes, and publishes through the existing database authority. No transport response itself creates availability. The web process subsequently looks up the exact committed operation. Lost replies remain uncertain and are reconciled against retained identity; there is no blind retry, alternate object key or fabricated success.

Uncertain sandbox creation/cleanup closes that worker instance to further validation until operator reconciliation/restart. Preserve owned-container evidence; never erase an uncertain outcome by reporting success. Before real use, verify actual MFA/revocation, wrong-origin denial, all supported file formats, immutable cloud writes and uncertain recovery on the deployed host, plus independent complete database/object/key restore. Supplier originals and job photos still need their own production dispatcher adoption; receipt wiring does not claim those workflows complete.
