// Local prerequisites only. This never verifies credentials or authorizes a route.
// A later request pipeline MUST additionally verify provider JWT + live session,
// active tenant membership/capability, CSRF and the transaction recovery fence.
export const sessionLimits = Object.freeze({
  trustedAbsoluteMs: 30 * 24 * 60 * 60 * 1000,
  trustedIdleMs: 7 * 24 * 60 * 60 * 1000,
  untrustedAbsoluteMs: 12 * 60 * 60 * 1000,
  recentAuthMs: 15 * 60 * 1000
});
export type LocalSession = {
  actorId: string;
  issuedSecurityEpoch: string;
  trusted: boolean;
  createdAt: number;
  authenticatedAt: number;
  lastActiveAt: number;
  expiresAt: number;
  revokedAt: number | null;
  reauthAt: number | null;
};
export type LocalActor = { id: string; kind: "owner" | "system"; securityEpoch: string; disabled: boolean };
type Reason = "INVALID_STATE" | "ACTOR_UNAVAILABLE" | "REVOKED" | "EXPIRED" | "IDLE" | "RECENT_AUTH_REQUIRED";
export type LocalSessionDecision =
  | { state: "denied"; reason: Reason }
  | { state: "locally_eligible"; providerAndTenantVerificationRequired: true; foregroundActivityAt: number | null };

export function localSessionEligibility(
  session: LocalSession | null,
  actor: LocalActor | null,
  now: number,
  interaction: "foreground" | "background",
  requireRecentAuth = false
): LocalSessionDecision {
  const deny = (reason: Reason): LocalSessionDecision => ({ state: "denied", reason });
  if (!session || !actor) return deny("ACTOR_UNAVAILABLE");
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const times = [now,session.createdAt,session.authenticatedAt,session.lastActiveAt,session.expiresAt];
  if (session.revokedAt !== null) times.push(session.revokedAt);
  if (session.reauthAt !== null) times.push(session.reauthAt);
  if (!times.every(Number.isSafeInteger) || typeof session.trusted !== "boolean" || typeof actor.disabled !== "boolean"
    || typeof requireRecentAuth !== "boolean" || !uuid.test(actor.id) || !uuid.test(session.actorId)
    || !uuid.test(actor.securityEpoch) || !uuid.test(session.issuedSecurityEpoch)
    || !["foreground","background"].includes(interaction)
    || session.authenticatedAt > session.createdAt || session.lastActiveAt < session.createdAt
    || session.expiresAt <= session.createdAt || session.lastActiveAt >= session.expiresAt
    || session.createdAt > now || session.lastActiveAt > now
    || (session.revokedAt !== null && (session.revokedAt < session.createdAt || session.revokedAt > now))
    || (session.reauthAt !== null && (session.reauthAt < session.createdAt || session.reauthAt >= session.expiresAt || session.reauthAt > now))) return deny("INVALID_STATE");
  if (actor.kind !== "owner" || actor.disabled || !actor.id || actor.id !== session.actorId
    || !actor.securityEpoch || actor.securityEpoch !== session.issuedSecurityEpoch) return deny("ACTOR_UNAVAILABLE");
  if (session.revokedAt !== null) return deny("REVOKED");
  const maximum = session.trusted ? sessionLimits.trustedAbsoluteMs : sessionLimits.untrustedAbsoluteMs;
  if (session.expiresAt - session.createdAt > maximum) return deny("INVALID_STATE");
  if (now >= session.expiresAt || now - session.createdAt >= maximum) return deny("EXPIRED");
  if (session.trusted && now - session.lastActiveAt >= sessionLimits.trustedIdleMs) return deny("IDLE");
  const authenticated = session.reauthAt ?? session.authenticatedAt;
  if (requireRecentAuth && now - authenticated >= sessionLimits.recentAuthMs) return deny("RECENT_AUTH_REQUIRED");
  // Apply this proposed activity update ONLY after all other request gates pass,
  // under the same session-row lock; polling/refresh must never extend inactivity.
  return { state: "locally_eligible", providerAndTenantVerificationRequired: true,
    foregroundActivityAt: interaction === "foreground" ? now : null };
}
