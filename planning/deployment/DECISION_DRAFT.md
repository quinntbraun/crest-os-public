# Deployment options for the single-owner release

Review-only cloud branch; no runtime/security policy change or provider operation. Production bootstrap ownership is unassigned here: coordinate before editing main/server/security/shared files. Public source reviewed: cloudc9ff354; native appointment47e6005d40; expenses8bfcc341. Private account inventory is unverified. Parent has assigned native47/48/49 exclusively.

## Visible baseline and ready seams

Tracked compose.yaml is a synthetic tmpfs PostgreSQL fixture. .env.example expressly excludes production secrets. No root Render manifest or production env file exists in this checkout; no Render/Supabase/R2/B2 configuration variables were present in this executor. Only presence was inspected, never secret values. There is no connected provider inventory tool or verified billing/project inventory; do not conclude accounts are absent.

createCrestApplication and createAuthenticationRuntime provide standard Node/Next, actual socket TLS, live owner MFA and verified PostgreSQL TLS. Private S3/receipt custody mechanics exist. main.ts still starts a test-only setup shell; domain production flags, receipt worker dispatch, operational backup scheduling, TLS health and private config loading are unfinished. The local Docker file validator is explicitly local/CI-only. It launches a separate network-none/read-only/cap-drop/resource-bounded container; generic Render cron support does not establish that sandbox capability. A supported production dispatcher/launcher is a feasibility gate for either host, and no evidence here proves Render can run the existing Docker-dependent adapter. Neither example is a runnable release or a new accepted application configuration format. No Docker socket, recovery private key or vault administration belongs in web.

## Two bounded candidates

| Option | Wiring | What needs proof/decision |
|---|---|---|
| Keep Render | Render TLS edge -> HTTP public proxy -> verified HTTPS private Node service; Supabase, private R2, independent B2; isolated scheduled worker/backup | Private services support arbitrary protocols, so re-encryption is technically available. It does not encrypt the earlier edge->proxy hop. Explicitly review that managed-platform trust boundary, prevent forged Host/XFF/protocol input, and keep bounded Node proxy peers updated safely as instance addresses change. Do not treat a loopback TLS wrapper as end-to-end proof. |
| Direct Node TLS VM | One standard Docker VM, public443 mapped to nonroot Node8443; same external DB/Auth/objects/vault; isolated worker/timer credentials | Avoids the extra HTTP proxy boundary and peer discovery. Requires approval to change the maintained Render hosting choice and responsibility for OS/cert updates. A2GiB VM is a benchmark candidate, not demonstrated minimum capacity. |

Render is not rejected merely because its public listener uses HTTP; the question is whether the additional trusted ingress is acceptable and can be proved without weakening current policy. Conversely, no official evidence shows its edge can be configured to originate TLS directly to this Node listener. The public proxy's upstream TLS alone does not answer the first-hop trust question. No policy exception is made by these drafts.

Render private discovery hostnames can resolve to different instance IPs between deploys. Current application proxy config accepts1..16 explicit normalized IPs, not hostnames, wildcard or broad CIDRs. A reviewed composition can resolve the exact trusted discovery name to a bounded set and restart/pin safely; implementation, source/provenance and rollout/rejection behavior need verification before activation. All requests still require genuine application authentication/CSRF/authority.

Examples: deploy/proposed/direct-node-tls.compose.yaml.example proposes the production image/entrypoint interface without implementing it; missing variables or missing production entrypoint fail closed. The Render fragment only declares verified upstream TLS, deliberately leaving client-IP provenance and complete ingress unsupplied. Do not deploy either by copying it blindly.

## Smallest service and cost inventory

Prices checked2026-10-29, estimates conditional on quotas and resource proof:

| Requirement | Render candidate | Direct VM candidate |
|---|---|---|
| Always-on public app ingress | Starter proxy512MiB$7/mo | Included in VM |
| Node app | Private Starter512MiB$7/mo only if measured memory passes | Basic2GiB/1vCPU50GiB$12/mo compute candidate |
| Intake/queue and backup tasks | Two isolated cron services, >=$1/mo each plus execution; resource plans separately sized | Credential-isolated tasks on same VM, included compute but contention and host-loss monitoring must be tested |
| DB/Auth | Supabase Free$0 within500MB/5GBegress quotas; inactivity pause and no automatic backup | Same |
| Private originals/previews | R2 Standard free allowances10GB-month/1mClassA/10mClassB, then$0.015/GB-month and request rates | Same |
| Independent vault | B2 published storage$6.95/TB/mo, egress limits apply; do not assume zero | Same |
| Alerts/monitor | Resend Free has100/day sending limit; Healthchecks offers20 free monitored jobs. Actual sender/account/delivery configuration unverified; no overage enabled or paid add-on assumed | Same |

Render infrastructure floor is therefore$16/mo at two512MiB services plus two cron minima, before execution/storage/transfer/tax/account charges. If Node needs Standard2GiB$25/mo, the same layout is at least$34/mo before usage, exceeding the maintained$30 total cap. No automatic upgrade. Direct VM compute floor is$12/mo candidate; it is not an all-in price. The4GiB VM is$24/mo before other usage if2GiB fails. A paid Supabase plan can also break the cap; no implicit fallback.

Memory cannot be certified by plan name. Current file validation limits are512MiB JPEG/PDF or1GiB HEIC plus app/OS/buffers. Validate one worker at a time, upload/download/report and backup contention. Build the pinned image in CI. Web and intake need independent resource limits. Neither512MiB Render app nor2GiB VM is accepted on current evidence.

Private receipts must remain S3 original/preview objects, with reserved short-lived PUTs and authenticated original downloads, hashes, immutable identities and no public GET. Production receipt dispatch remains a separate review. Database backup alone is incomplete. Capture a consistent DB plus referenced original bytes/metadata/source/config/key recovery material; encrypt to independent vault; verify custody/retention before marking complete. Preserve maintained six-hour/35daydaily/400daymonth-end policy and independent missed-heartbeat alerts. VM disk or provider snapshot is not the sole copy. Existing disposable recovery drills do not configure operational production backup.

## Minimal next approval request for parent to present

Read-only inventory and isolated preparation are already authorized; do not ask permission again for them. Use existing connected read-only access if available. This executor has no Render inventory connector or visible configured service. The first missing-input request is therefore only: **Which existing Render workspace/service is Crest using, and can its authorized account inventory be made available read-only? Provide nonsecret identifiers, never tokens.** This is an access/context dependency, not a new permission request for routine research.

If inventory confirms two new services are necessary, the bounded approval text is: **May we create two Render Starter services for a synthetic ingress-only staging proof, at$7/month each ($14/month compute combined, prorated while present), with no production database/data, DNS switch, new object/vault services or security-policy relaxation?** Confirm any existing account/platform charges before this request, and include a removal date after the proof. No charge is incurred by these draft files. Production/cron purchasing is a later separately priced decision after resource and trust-boundary proof.

After that inventory and ingress proof, present ONE priced topology with a maximum additional charge and exact account/region/service names. The$30 ceiling is not purchase authorization. If Render cannot meet the boundary/resources/budget, ask for the explicit VM substitution and$12/mo compute candidate plus a separately bounded measured usage allowance. Do not ask for blanket permission for every provider.

Later narrowly scoped owner setup: actual hostname/TLS/DNS, specific project owner/factor/business binding, restricted DB login, private R2/vault and retention settings, recovery-key custody and alert destination. Complete reviewed production bootstrap/dispatch/backup/health wiring and one genuine configured workflow+receipt+independent restore before real data. Object-lock policy/retention creation and new access grants remain explicit setup actions. No external action has occurred in this draft.

## Official evidence

- Render public edge TLS termination/HTTP forwarding: https://render.com/docs/web-services
- Private protocols/discovery/dynamic instance IPs: https://render.com/docs/private-network ; https://render.com/docs/private-services
- Render pricing/cron minimum: https://render.com/pricing ; https://render.com/docs/cronjobs
- Direct VM prices: https://www.digitalocean.com/pricing/droplets
- DB/Auth free quotas/pausing/backup absence: https://supabase.com/pricing
- Private object pricing: https://developers.cloudflare.com/r2/pricing/
- Independent vault pricing: https://www.backblaze.com/cloud-storage/pricing

Alert free-tier evidence: https://resend.com/pricing ; https://healthchecks.io/ . Upstream TLS directive syntax: https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_ssl_verify .
