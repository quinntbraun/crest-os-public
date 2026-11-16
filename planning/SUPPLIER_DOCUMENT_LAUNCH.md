# Fictional supplier document launch

Schema 109's supplier bill draft, payable review, posting and settlement remain separate steps. The document worker verifies bytes and publishes evidence for the exact saved bill revision. It cannot post the bill or record a payment.

## Launcher contract

After building the application, add `--supplier-payables` to the existing fictional laptop or private phone launcher arguments. The option needs reviewed finance and money-channel setup and the schema 109 posted-finance export profile. Startup refuses a missing worker or incorrectly bound web storage profile. Earlier schema launchers and the default application retain their existing capabilities.

Provision two private profiles under the owned workspace's `supplier-documents` directory. Use a dedicated loopback-only synthetic bucket named `crest-synthetic-*` or `crest-fictional-*` and an `application/octet-stream` object at `originals/_crest_store_identity` whose exact bytes are `crest synthetic storage <workspaceId>`. Reply with the exact content length. Web and worker profiles must identify the same bucket and origin.

- `web.json` contains `version: 1`, the 16-hex-character `workspaceId`, the loopback HTTP `origin` with an explicit port, the `bucket`, and explicit S3 `credentials` with `accessKeyId` and `secretAccessKey`. Allow writes to staging and verified reads of the private objects. The web launcher reads this file.
- `worker.json` contains `environment: "test"`, the authoritative `businessId`, the same storage profile under `storage` with separate worker credentials, a `workerConnectionString`, a `decoder` object, and the workspace's existing session-verification `authentication` configuration. Encode its login key and each token key as base64url strings. Scope the new PostgreSQL login to `crest_supplier_bill_document_worker` on the same loopback test database. Grant the worker storage identity staging reads and immutable original and preview candidate writes and reads. The isolated child reads this profile.
- Pin the decoder to an accepted `sha256:…` image in `decoder.imageId`. The Windows launcher also supplies the absolute Docker Desktop `docker.exe` path as `decoder.dockerExecutable`. The Linux launcher uses the fixed local Docker socket. The decoder cannot access the network or mount the host filesystem, and its reply still needs content and checksum verification.

Keep these files in the owned private workspace with restricted local access. The child communicates over IPC without a listener. One request can be active per launcher. A transport crash or inconclusive decoder cleanup closes that launcher's dispatch capability until restart and operator review. Check the saved upload result before retrying a verification whose response was lost. No financial action is retried automatically.

## Release checks

The signed-in supplier browser test uses the same worker launcher when supplied an exact decoder image ID. It exercises actual MFA, a disposable schema 109 database, the real SDK against a loopback storage fixture, PDF decoding, lost reply recovery, the private preview, bill posting and partial settlement. This proves the path under that fixture. Owned storage policies and release rehearsal require separate verification using the candidate image and persistent service. Include both supplier object variants in the backup inventory and verify both on independent restore before an installed upgrade.
