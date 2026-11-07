import { describe, expect, it } from "vitest";
import { buildCalendarEventProjection, type CalendarProjectionInput } from "../../src/calendar/event-projection";

const origin = "https://crest.example.com";
const fixture = (): CalendarProjectionInput => ({
  schemaVersion: 1,
  eventIdentity: "00000000-0000-4000-8000-000000000001",
  jobReference: "00000000-0000-4000-8000-000000000002",
  appointmentVersion: "9007199254740993",
  appointmentState: "confirmed",
  window: {
    timeZone: "America/Indiana/Indianapolis",
    start: { instant: "2026-10-29T22:00:00Z", localDateTime: "2026-10-29T18:00:00", offsetMinutes: -240 },
    end: { instant: "2026-10-30T00:30:00Z", localDateTime: "2026-10-29T20:30:00", offsetMinutes: -240 }
  },
  consent: { version: "1", clientDisplayName: false, serviceLabel: false, workAddress: false },
  optionalFields: { clientDisplayName: "Private client", serviceLabel: "Private service", workAddress: "Private address" }
});

describe("Calendar GC03/GC15 offline payload preview", () => {
  it("has an exact minimal payload without contact, money, source objects, guests or inherited reminders", () => {
    const result = buildCalendarEventProjection(fixture(), origin);
    expect(result).toEqual({
      id: "00000000000040008000000000000001",
      summary: "Crest job",
      description: `Crest job reference: ${fixture().jobReference}\nOpen Crest OS: ${origin}/jobs/${fixture().jobReference}`,
      location: "",
      start: { dateTime: "2026-10-29T22:00:00.000Z", timeZone: "America/Indiana/Indianapolis" },
      end: { dateTime: "2026-10-30T00:30:00.000Z", timeZone: "America/Indiana/Indianapolis" },
      visibility: "private", transparency: "opaque", reminders: { useDefault: false, overrides: [] },
      source: { title: "Crest OS", url: `${origin}/jobs/${fixture().jobReference}` },
      extendedProperties: { private: { crestProjection: "1", crestJobReference: fixture().jobReference,
        crestAppointmentVersion: "9007199254740993", crestConsentVersion: "1" } }
    });
    expect(JSON.stringify(result)).not.toContain("Private");
  });

  for (const field of ["clientDisplayName", "serviceLabel", "workAddress"] as const) {
    it(`shares only the individually selected ${field}`, () => {
      const value = fixture();
      const result = buildCalendarEventProjection({ ...value, consent: { ...value.consent, [field]: true } }, origin);
      const json = JSON.stringify(result);
      for (const key of ["clientDisplayName", "serviceLabel", "workAddress"] as const) {
        expect(json.includes(value.optionalFields[key]!)).toBe(key === field);
      }
    });
  }

  it("escapes HTML-capable description while preserving legitimate Unicode display text", () => {
    const value = fixture();
    const result = buildCalendarEventProjection({ ...value,
      consent: { version: "2", clientDisplayName: true, serviceLabel: true, workAddress: true },
      optionalFields: { clientDisplayName: "Zoë & 李", serviceLabel: '<img src="https://evil.example.com/"> & clean', workAddress: "12 Example Lane" }
    }, origin);
    expect(result.summary).toBe("Crest job — Zoë & 李");
    expect(result.description).toContain("&lt;img src=&quot;https://evil.example.com/&quot;&gt; &amp; clean");
    expect(result.description).not.toContain("<img");
    expect(result.location).toBe("12 Example Lane");
    expect(result.extendedProperties.private.crestConsentVersion).toBe("2");
  });

  it("clears all previously shared managed fields when consent is disabled without changing event identity", () => {
    const value = fixture();
    const shared = buildCalendarEventProjection({ ...value, consent: { version: "1", clientDisplayName: true, serviceLabel: true, workAddress: true } }, origin);
    const minimal = buildCalendarEventProjection({ ...value, consent: { ...value.consent, version: "2" } }, origin);
    expect(minimal.id).toBe(shared.id);
    expect(minimal.summary).toBe("Crest job");
    expect(minimal.location).toBe("");
    expect(JSON.stringify(minimal)).not.toContain("Private");
  });

  it("keeps event identity stable through appointment versions and completion; distinct mappings stay distinct", () => {
    const value = fixture();
    const original = buildCalendarEventProjection(value, origin);
    const completed = buildCalendarEventProjection({ ...value, appointmentState: "completed", appointmentVersion: "9007199254740994" }, origin);
    expect(completed.id).toBe(original.id);
    expect(completed.start).toEqual(original.start);
    expect(completed.extendedProperties.private.crestAppointmentVersion).toBe("9007199254740994");
    expect(buildCalendarEventProjection({ ...value, eventIdentity: value.jobReference }, origin).id).not.toBe(original.id);
  });

  it("deep freezes its detached payload so preview and caller input cannot mutate it", () => {
    const value = fixture();
    const result = buildCalendarEventProjection(value, origin);
    const frozen = (object: object) => {
      expect(Object.isFrozen(object)).toBe(true);
      for (const child of Object.values(object)) if (child && typeof child === "object") frozen(child);
    };
    frozen(result);
    expect(() => Object.assign(result, { location: "changed" })).toThrow();
    Object.assign(value.consent, { clientDisplayName: true });
    expect(result.summary).toBe("Crest job");
  });

  it.each(["proposed", "draft", "cancelled", "reschedule_pending", null])("does not publish unconfirmed or cancelled source %s", appointmentState => {
    expect(() => buildCalendarEventProjection({ ...fixture(), appointmentState }, origin)).toThrow("CALENDAR_PROJECTION_INVALID");
  });

  it.each(["http://crest.example.com", "javascript:alert(1)", "https://user:password@crest.example.com", "https://crest.example.com/path",
    "https://crest.example.com?token=secret", "https://crest.example.com/#secret", "https://crest.example.com/../", " https://crest.example.com", "https://crest.example.com\n"])("rejects unsafe or noncanonical application origin %#", value => {
    expect(() => buildCalendarEventProjection(fixture(), value)).toThrow("CALENDAR_PROJECTION_INVALID");
  });

  it.each(["phone", "email", "notes", "price", "attendees", "conferenceData", "credentials"])("refuses extra source field %s rather than spreading it", key => {
    expect(() => buildCalendarEventProjection({ ...fixture(), [key]: "sensitive" }, origin)).toThrow("CALENDAR_PROJECTION_INVALID");
  });

  it.each(["0", "01", "-1", "1.5", "1e2", "9223372036854775808", "1\n", 1, null])("rejects invalid or lossy source/consent version %#", value => {
    expect(() => buildCalendarEventProjection({ ...fixture(), appointmentVersion: value }, origin)).toThrow("CALENDAR_PROJECTION_INVALID");
    expect(() => buildCalendarEventProjection({ ...fixture(), consent: { ...fixture().consent, version: value } }, origin)).toThrow("CALENDAR_PROJECTION_INVALID");
  });

  it.each(["", "\n", "injected\r\nGuests: external", "hidden\u202evalue", "null\u0000value", "lone\ud800", "text\u2028line", "a".repeat(301)])("rejects unsafe selected text %# without echoing it", text => {
    const value = fixture();
    expect(() => buildCalendarEventProjection({ ...value,
      consent: { ...value.consent, serviceLabel: true }, optionalFields: { ...value.optionalFields, serviceLabel: text }
    }, origin)).toThrow(/^CALENDAR_PROJECTION_INVALID$/);
  });

  it.each([
    { eventIdentity: "not-an-opaque-uuid" }, { jobReference: "../../private" },
    { eventIdentity: "00000000-0000-4000-8000-000000000001\n" },
    { consent: { ...fixture().consent, clientDisplayName: "true" } },
    { optionalFields: { ...fixture().optionalFields, serviceLabel: {} } },
    { consent: { ...fixture().consent, extra: true } },
    { optionalFields: { ...fixture().optionalFields, notes: "secret" } },
    { schemaVersion: 2 }
  ])("rejects malformed identities or expanded consent shapes %#", patch => {
    expect(() => buildCalendarEventProjection({ ...fixture(), ...patch }, origin)).toThrow("CALENDAR_PROJECTION_INVALID");
  });

  it("requires an actual selected value, but does not inspect or serialize unselected text", () => {
    const value = fixture();
    expect(() => buildCalendarEventProjection({ ...value, consent: { ...value.consent, clientDisplayName: true },
      optionalFields: { ...value.optionalFields, clientDisplayName: null } }, origin)).toThrow("CALENDAR_PROJECTION_INVALID");
    expect(buildCalendarEventProjection({ ...value, optionalFields: { clientDisplayName: "\ud800", serviceLabel: "\u202e", workAddress: null } }, origin).summary).toBe("Crest job");
  });
});
