# Free local durable CRM testing

The genuine synthetic workspace is initialized and running at **https://127.0.0.1:4319** on this Windows computer. This is fictional testing only, not an approved real-data release.

## Current installation — 2026-10-28

Docker Desktop/WSL2 is installed. The explicitly approved pinned Linux coordinator applied all44 registered migrations. Genuine Auth/TOTP, one synthetic owner, restricted application login and an owned persistent volume are configured. Original setup failure evidence is retained; no database reset or role-guard relaxation was used.

The owner reviewed and completed the local browser certificate step. The agent then signed in through genuine Auth/TOTP and exercised the actual UI. No automatic browser exception or host trust-store change was used. The server also passed normal HTTPS verification using the exact certificate as the request's local trust anchor.

Private generated sign-in details are in **.local/synthetic-workspace/owner-credentials.json** in the active checkout. Do not copy these into chat, Git, CI or screenshots. Its totpUri is private enrollment material, not a public link.

From the active checkout, with pinned Node24.22/npm11.19.1 available:

- **npm run workspace:start** starts the existing owned services and genuine app at4319.
- **npm run workspace:stop** stops only the labeled synthetic containers, retaining their data volume. Stop the foreground application before this command.
- Do not rerun **workspace:init**, delete state/initialization markers, recreate users or reset the volume. Interrupted initialization requires review.

Installation-specific checks PASSED: genuine browser sign-in; customer/vehicle/link save and reload; saved customer JSON/history; service create/reload/edit with both history revisions and saved JSON. A controlled complete app/Auth/database stop/start preserved the same customer, vehicle, link and service identities/versions, and the browser reopened saved records afterward. Private receipts/screenshots are retained. This demonstrates the first durable fictional workflow, not complete V1 or real-use acceptance. The separate4318 sample remains temporary fictional data.

## Optional private iPhone preview

The owner-approved Windows and iPhone NetBird clients are installed and signed into the same free account. The owner confirmed the actual iPhone can sign in with genuine password/TOTP authentication and open Customers, including through its private connection. This is an owned synthetic test endpoint, not production approval or a publicly hosted service.

Keep `npm run workspace:start` running, then run **npm run workspace:phone** in a second terminal. The Windows-only runner reuses the existing owner, database, restricted application login and issuer bridge; it creates no account or database. It checks the saved private two-device binding against the installed NetBird client's current identity, binds only the laptop's private address, and rejects socket peers outside the two configured devices. Forwarded headers cannot grant access. Adding/changing devices or replacing an expired certificate requires reviewed local configuration; the runner fails closed.

Private configuration lives in `.local/synthetic-workspace/phone-preview.json`, `phone.key` and `phone.pem`. The matching, currently valid, self-signed non-CA certificate must cover the configured private address and match its saved hash. Keep both key and binding private. No wildcard listener, public tunnel, host trust-store change, automatic browser certificate exception or authentication bypass is used. The owner handles any browser warning. The optional prepared firewall helper was blocked by Windows script policy before execution; no rule or execution-policy change was made. The actual phone connection already works.

The local private sign-in sheet is `owner-phone-sign-in-private.txt`; its separate QR contains existing authenticator enrollment material. Neither belongs in chat, screenshots, Git or CI. Following the owner's explicit test-login change, the same provider subject and verified factor remain linked; previous provider sessions were revoked, and the new credentials passed an HTTPS session-confirmation/sign-out diagnostic. Keep the existing verification-code setup when editing the saved password-manager entry. The earlier failed iPhone attempt has no proven root cause; successful retry is confirmed by the owner.

The laptop must remain awake, online and running Docker, the main workspace and phone runner; the iPhone must have NetBird connected. This does not establish independent hosting, unattended uptime, real-data readiness or full V1 acceptance. No paid plan was purchased.

## Fresh installations: validate TLS before provisioning

The PostgreSQL image does not contain an openssl executable. The installer now reads and validates an explicitly prepared **.local/synthetic-workspace/tls.key** and **tls.pem** before writing an initialization marker or creating any container/database/account. It requires a matching, currently valid, self-signed non-CA certificate covering both127.0.0.1 and localhost. Start validates the same pair and stored certificate hash.

For a new checkout only, an already installed trusted OpenSSL can prepare the pair for free:

```text
mkdir .local/synthetic-workspace
openssl req -x509 -newkey rsa:2048 -noenc -keyout .local/synthetic-workspace/tls.key -out .local/synthetic-workspace/tls.pem -days 30 -subj /CN=localhost -addext subjectAltName=IP:127.0.0.1,DNS:localhost -addext basicConstraints=critical,CA:FALSE
```

Keep the private key local with restrictive file permissions. Do not overwrite an existing installation's pair, install it as a trusted root, or disable certificate checks. Expiry/replacement requires explicit reviewed local maintenance. This computer's pair was generated with its already-bundled cryptography runtime; no purchase or software installation was needed.

A fresh installation also requires the supported official Docker/WSL prerequisites and explicit provisioning authorization. Use [Microsoft's WSL guide](https://learn.microsoft.com/en-us/windows/wsl/install) and [Docker's Windows guide](https://docs.docker.com/desktop/setup/install/windows-install/); the owner handles administrator/restart/terms prompts. Docker's [license guide](https://docs.docker.com/subscription-billing/desktop-license/) determines eligibility for free use.

## Setup defects and retained evidence

The pinned CLI classifies local targets using hostname and the configured database port. The original staging configuration omitted the actual port and stepped the owned loopback connection down to postgres, tripping Crest's unchanged role invariant. The correction supplies the already-verified loopback hostname/port. Failed attempts, reviewed pending records and the successful44-migration receipt stay private in .local.

A direct privileged rollback probe was rejected by automatic approval review and was not executed. The successful path used read-only diagnostics and the approved coordinator. Never bypass that boundary with direct privileged SQL.

The loopback workspace needs no cloud account or paid service. Optional phone access uses the separately approved free private-network account described above. Public tunnels, real business records and financial activation remain outside this test setup. Full exports, independent recovery and other real-use gates remain required. Installing Docker or starting this test server does not make Crest OS ready for real Crest data.
