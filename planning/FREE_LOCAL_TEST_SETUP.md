# Free local durable CRM testing: setup handoff

2026-10-27. This is the prerequisite path for a genuine local PostgreSQL/Auth test installation. The existing sample preview continues working without it. No paid account is required for this local direction.

## Current computer

Checks found the pinned Node24.22 and Supabase CLI2.121.0, but no Docker/Podman/PostgreSQL executable; Windows reports WSL is not installed. Existing Windows application-control restrictions must remain intact. The current compose.yaml uses a disposable tmpfs test database and deliberately is not a persistent business installation.

## Owner's one-time Windows actions

1. Save open work before any restart. Follow [Microsoft's WSL installation guide](https://learn.microsoft.com/en-us/windows/wsl/install): open an administrator PowerShell, run wsl --install and restart when required. Complete the distribution's user/password prompts yourself. Do not send passwords to the chat.
2. Install and start Docker Desktop using the [official Windows guide](https://docs.docker.com/desktop/setup/install/windows-install/), choosing the WSL2/Linux-container backend. Review/accept its terms yourself. Docker documents free use for eligible small businesses (fewer than250 employees and under$10million annual revenue), personal use, education and noncommercial open source in its [license guide](https://docs.docker.com/subscription-billing/desktop-license/).
3. Confirm Docker shows its engine running. Tell Codex that WSL/Docker are ready. Codex can then run bounded version/engine checks and continue the actual sample setup.

The installer requires an eligible Windows build and virtualization support; follow the official guide if it reports a missing prerequisite. No BIOS, administrator, host-access group, security-policy or terms changes have been made by the agent. A restart cannot be safely completed while the owner is away.

## Engineering work after those prerequisites

Use pinned genuine PostgreSQL and Auth with a separate persistent synthetic workspace/volume and loopback-only ports. Do not turn the disposable CI tmpfs database into the persistent test store. Build/run the actual application in the supported Linux runtime, configure its existing trusted server composition, provision only a synthetic test owner, exercise real MFA/session/RLS/recovery gates and verify save/reopen across a controlled restart. Add portable export/recovery checks and show the resulting actual app.

The default executable currently stays a closed setup shell; installing Docker alone will not activate an owner app. No environment switch, fake Auth, SQLite/JSON replacement, weakened roles or unreviewed production provisioning is part of this handoff. Ordinary source/CI acceptance and the known isolated export-admission issue remain separate.

## Free alternatives investigated

Supabase's [native runtime guide](https://supabase.com/docs/guides/local-development/docker-and-native-runtimes) explicitly excludes Windows; updating the CLI cannot make that path supported. Native Linux or supported macOS can avoid Docker, including after a later deliberate machine transfer. [Portable PostgreSQL for Windows](https://www.postgresql.org/download/windows/) is available, but a standalone database omits the application's Auth/provider stack and required production-equivalent extensions/acceptance. It is not a quality-preserving shortcut here.

A cloud free tier would need an owner account/consent and a separate backup/reliability assessment; none is necessary for the recommended local synthetic setup. No signup, cloud resource, purchase, public tunnel, production database or real business record was created.

Current preview data is still temporary. Keep using fictional records until a separately approved real-use release passes its required gates.
