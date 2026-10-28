# Free local durable CRM testing

The genuine synthetic workspace is initialized and running at **https://127.0.0.1:4319** on this Windows computer. This is fictional testing only, not an approved real-data release.

## Current installation — 2026-10-28

Docker Desktop/WSL2 is installed. The explicitly approved pinned Linux coordinator applied all44 registered migrations. Genuine Auth/TOTP, one synthetic owner, restricted application login and an owned persistent volume are configured. Original setup failure evidence is retained; no database reset or role-guard relaxation was used.

The local browser currently shows its self-signed certificate warning. The owner must review and perform any browser exception themselves. No automatic browser exception or host trust-store change is authorized. The application server independently passed normal HTTPS verification using that exact certificate as the request's local trust anchor. This is not a completed owner browser journey.

Private generated sign-in details are in **.local/synthetic-workspace/owner-credentials.json** in the active checkout. Do not copy these into chat, Git, CI or screenshots. Its totpUri is private enrollment material, not a public link.

From the active checkout, with pinned Node24.22/npm11.19.1 available:

- **npm run workspace:start** starts the existing owned services and genuine app at4319.
- **npm run workspace:stop** stops only the labeled synthetic containers, retaining their data volume. Stop the foreground application before this command.
- Do not rerun **workspace:init**, delete state/initialization markers, recreate users or reset the volume. Interrupted initialization requires review.

Owner browser sign-in, customer/vehicle/link save/reload, history/limited JSON and a controlled service restart still require installation-specific verification. Current-source CI covers these functional paths in isolated synthetic installations; it does not prove this computer's owner handoff. The separate4318 sample remains temporary fictional data.

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

No cloud account, paid service, public tunnel, real business record or financial activation is needed or authorized. Full exports, independent recovery and other real-use gates remain required. Installing Docker or starting this test server does not make Crest OS ready for real Crest data.
