import { describe, expect, it } from "vitest";
import { localSessionEligibility } from "../../src/security/session-policy.ts";
import type { LocalActor, LocalSession } from "../../src/security/session-policy.ts";

const created = Date.parse("2026-10-21T11:00:00.000Z");
const hour = 60*60*1000;
const actor: LocalActor = { id: "00000000-0000-4000-8000-000000000001", kind: "owner",
  securityEpoch: "00000000-0000-4000-8000-000000000002", disabled: false };
// Expected bounds come from SECURITY2, independently of production constants.
const fixture = (trusted = true): LocalSession => ({ actorId: actor.id, issuedSecurityEpoch: actor.securityEpoch,
  trusted, createdAt: created, authenticatedAt: created, lastActiveAt: created,
  expiresAt: created + (trusted ? (30*24*hour) : (12*hour)), revokedAt: null, reauthAt: null });
const check = (s: LocalSession | null, now = created, recent = false, a: LocalActor | null = actor) => localSessionEligibility(s,a,now,"foreground",recent);

describe("SECURITY2 local session prerequisites", () => {
  it("never returns authentication/authorization; foreground activity is only a proposal", () => {
    expect(check(fixture(),created+1)).toEqual({ state: "locally_eligible", providerAndTenantVerificationRequired: true, foregroundActivityAt: created+1 });
    expect(localSessionEligibility(fixture(),actor,created,"background")).toEqual({ state: "locally_eligible", providerAndTenantVerificationRequired: true, foregroundActivityAt: null });
  });
  it("background polling cannot extend the trusted seven-day idle window", () => {
    const s = fixture();
    expect(localSessionEligibility(s,actor,created+(7*24*hour)-1,"background").state).toBe("locally_eligible");
    expect(check(s,created+(7*24*hour))).toEqual({ state:"denied",reason:"IDLE" });
    expect(s.lastActiveAt).toBe(created);
  });
  it.each([true,false])("absolute limit has no grace period for trusted=%s", (trusted) => {
    const s = fixture(trusted); const limit = s.expiresAt;
    s.lastActiveAt = limit-1;
    expect(check(s,limit-1).state).toBe("locally_eligible");
    expect(check(s,limit)).toEqual({ state:"denied",reason:"EXPIRED" });
    expect(check(s,limit+1)).toEqual({ state:"denied",reason:"EXPIRED" });
  });
  it("earlier explicitly shortened expiry is enforced", () => {
    const s = {...fixture(),expiresAt:created+hour};
    expect(check(s,created+hour-1).state).toBe("locally_eligible");
    expect(check(s,created+hour)).toEqual({ state:"denied",reason:"EXPIRED" });
  });
  it("untrusted session has the specified twelve-hour absolute cap", () => {
    expect(check(fixture(false),created+12*hour-1).state).toBe("locally_eligible");
    expect(check(fixture(false),created+12*hour)).toEqual({ state:"denied",reason:"EXPIRED" });
  });
  it("recent authentication expires exactly at fifteen minutes", () => {
    expect(check(fixture(),created+(15*60*1000)-1,true).state).toBe("locally_eligible");
    expect(check(fixture(),created+(15*60*1000),true)).toEqual({ state:"denied",reason:"RECENT_AUTH_REQUIRED" });
    expect(check(fixture(),created+(15*60*1000),false).state).toBe("locally_eligible");
  });
  it("foreground activity/provider refresh never renew recent authentication", () => {
    const now = created+hour;
    expect(check({...fixture(),lastActiveAt:now},now,true)).toEqual({ state:"denied",reason:"RECENT_AUTH_REQUIRED" });
    const reauthenticated = {...fixture(),lastActiveAt:now,reauthAt:now};
    expect(check(reauthenticated,now,true).state).toBe("locally_eligible");
    expect(check(reauthenticated,now+(15*60*1000),true)).toEqual({ state:"denied",reason:"RECENT_AUTH_REQUIRED" });
  });
  it("logout is final on the next protected request", () => {
    const s = {...fixture(),revokedAt:created};
    expect(check(s)).toEqual({ state:"denied",reason:"REVOKED" });
    expect(check(s,created+1)).toEqual({ state:"denied",reason:"REVOKED" });
  });
  it.each([
    { ...actor,disabled:true }, { ...actor,kind:"system" as const },
    { ...actor,id:"00000000-0000-4000-8000-000000000003" },
    { ...actor,securityEpoch:"00000000-0000-4000-8000-000000000004" }
  ])("live actor/epoch changes deny without a cross-request cache: %j", (changed) => {
    expect(check(fixture(),created,false,changed)).toEqual({ state:"denied",reason:"ACTOR_UNAVAILABLE" });
  });
  it("missing actor/session cannot qualify", () => {
    expect(check(null).state).toBe("denied"); expect(check(fixture(),created,false,null).state).toBe("denied");
  });
  it.each([
    { createdAt:NaN }, { expiresAt:Infinity }, { lastActiveAt:created+0.5 }, { authenticatedAt:created+1 },
    { lastActiveAt:created-1 }, { createdAt:created+1 }, { lastActiveAt:created+1 },
    { expiresAt:created }, { expiresAt:created+(30*24*hour)+1 },
    { revokedAt:created-1 }, { revokedAt:created+1 }, { reauthAt:created-1 }, { reauthAt:created+1 },
    { issuedSecurityEpoch:"invalid" }
  ])("malformed/future timestamps or identity fail closed: %j", (patch) => {
    expect(check({...fixture(),...patch})).toEqual({ state:"denied",reason:"INVALID_STATE" });
  });
  it("missing/revoked/expired state never proposes an activity update", () => {
    for (const state of [check(null),check({...fixture(),revokedAt:created}),check(fixture(false),created+12*hour)]) expect(state).not.toHaveProperty("foregroundActivityAt");
  });
  it("elapsed limits remain hours across DST, independent of a display timezone", () => {
    const beforeDST = Date.parse("2026-11-01T04:00:00Z");
    const s = {...fixture(false),createdAt:beforeDST,authenticatedAt:beforeDST,lastActiveAt:beforeDST,expiresAt:beforeDST+12*hour};
    expect(check(s,beforeDST+12*hour-1).state).toBe("locally_eligible");
    expect(check(s,beforeDST+12*hour).state).toBe("denied");
  });
});
