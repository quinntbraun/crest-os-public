# Production condition photos

This production slice adopts the existing custody photo workflow. It adds no schema, grant, custody policy or business-rule change. [Pickup and return production adoption](PRODUCTION_PICKUP_RETURN.md) now selects their photo modes only with explicit pickup/release capabilities and actual photo-worker material. This implementation does not claim the whole job workflow accepted.

The web profile declares `dropoffPhotos` and all existing custody dependencies, together with a `photos` block. That block has the same exact storage/worker fields documented for the [receipt connection](PRODUCTION_RECEIPT_WORKER.md): explicit fixed-endpoint R2 credentials, HTTPS worker origin, pinned worker leaf and absolute client key/certificate/CA paths. It selects the fixed `/v1/custody-photos/verify` endpoint, not the receipt endpoint. The business/account/bucket binding has a distinct photo purpose. Mixed payloads, candidate metadata, another business/storage binding and arbitrary upload destinations are refused.

The separate photo worker authentication profile uses direct TLS, with no managed ingress, finance, receipt or photo storage blocks. Its exact declared base capability list is:

```
customers, vehicles, associations, operationResolution, quotes, quoteReview,
quoteCommercial, scheduling, quoteAmendments, quoteAmendmentAcceptance,
fieldSessions, dropoffCustody
```

These preserve the existing dependency graph; they do not expose additional worker HTTP handlers. After the actual bundled release gate passes, fixed worker composition adds only `dropoffPhotos`. The worker only exposes its certificate-authenticated photo protocol.

The private photo worker profile has the same fields as the receipt worker profile, plus required `workerConnectionString`. This is a distinct restricted login to the same PostgreSQL host/port/database as the worker authentication profile. It can assume only the existing `crest_custody_photo_dispatch` role, with explicit SET membership, no inheritance/admin option, no other memberships, no superuser/BYPASSRLS/create/replication privileges. The command role remains closed NOLOGIN/NOINHERIT with no parent memberships. Production verifies those role properties on connection and verifies database TLS. The web app never receives that worker login or publication method. Both encoded-equivalent usernames and another database are refused.

After complete release and target acceptance, the fixed entry command is:

```
node server/photo-worker.mjs --production-photo-worker /absolute/private/photo-worker.json
```

Both application and worker retain the actual release-acceptance gate; an environment flag cannot activate them. Use the same accepted source image and pinned Linux decoder. The actual host must support the direct mutual-TLS listener and isolated Docker validation described in the receipt deployment decision. No host/provider, paid provisioning or production credentials are supplied by this implementation.

The existing typed-parent reservation, current-session verification, recovery fence, immutable conditional writes, uncertain-write readback, decoder verification and database publication remain authoritative. Request scope/business are sealed before asynchronous session verification. The web app re-reads committed state after dispatch; the worker's reply contains no candidate bytes or asserted availability. Original downloads retain their separate access audit and fresh authorization checks. Caller cancellation, shutdown cleanup and uncertain sandbox cleanup use the same closed behavior as the receipt connection.

Production cloud/identity/decoder acceptance, physical phone capture/HEIC behavior, complete photo source export and independent database/object/key restoration remain release requirements. Real TLS protocol tests and prospective constructor tests do not prove those deployed workflows.
