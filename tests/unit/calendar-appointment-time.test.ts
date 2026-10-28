import { describe, expect, it } from "vitest";
import { validateAppointmentWindow } from "../../src/calendar/appointment-time";

const time = (instant: string, localDateTime: string, offsetMinutes: number) => ({ instant, localDateTime, offsetMinutes });
const fixture = () => ({
  timeZone: "America/Indiana/Indianapolis",
  start: time("2026-10-29T22:00:00Z", "2026-10-29T18:00:00", -240),
  end: time("2026-10-30T00:30:00Z", "2026-10-29T20:30:00", -240)
});

describe("Calendar GC04 offline reviewed-time validation", () => {
  it("preserves the original zone, UTC date rollover and independent end instant", () => {
    expect(validateAppointmentWindow(fixture())).toEqual({
      start: { dateTime: "2026-10-29T22:00:00.000Z", timeZone: "America/Indiana/Indianapolis" },
      end: { dateTime: "2026-10-30T00:30:00.000Z", timeZone: "America/Indiana/Indianapolis" }
    });
  });

  it.each([
    ["2026-11-01T05:30:00Z", -240],
    ["2026-11-01T06:30:00Z", -300]
  ])("accepts an explicitly disambiguated fall-back occurrence %s", (instant, offset) => {
    const value = fixture();
    value.start = time(instant, "2026-11-01T01:30:00", offset);
    value.end = time("2026-11-01T07:30:00Z", "2026-11-01T02:30:00", -300);
    expect(validateAppointmentWindow(value).start.dateTime).toBe(instant.replace("Z", ".000Z"));
  });

  it("accepts an appointment crossing a repeated hour using each endpoint's reviewed offset", () => {
    const value = fixture();
    value.start = time("2026-11-01T05:45:00Z", "2026-11-01T01:45:00", -240);
    value.end = time("2026-11-01T06:15:00Z", "2026-11-01T01:15:00", -300);
    expect(validateAppointmentWindow(value).end.dateTime).toBe("2026-11-01T06:15:00.000Z");
  });

  it.each([-300, -240])("rejects a spring gap even with a supplied offset %s", offset => {
    const value = fixture();
    value.start = time(offset === -300 ? "2026-03-08T07:30:00Z" : "2026-03-08T06:30:00Z", "2026-03-08T02:30:00", offset);
    expect(() => validateAppointmentWindow(value)).toThrow("CALENDAR_APPOINTMENT_TIME_INVALID");
  });

  it("accepts spring transition endpoints without inferring a wall-clock duration", () => {
    const value = fixture();
    value.start = time("2026-03-08T06:30:00Z", "2026-03-08T01:30:00", -300);
    value.end = time("2026-03-08T07:30:00Z", "2026-03-08T03:30:00", -240);
    expect(validateAppointmentWindow(value).end.dateTime).toBe("2026-03-08T07:30:00.000Z");
  });

  it.each([
    ["Asia/Kathmandu", 345, "2026-10-29T23:45:00", "2026-10-30T00:45:00"],
    ["Pacific/Kiritimati", 840, "2026-10-30T08:00:00", "2026-10-30T09:00:00"],
    ["UTC", 0, "2026-10-29T18:00:00", "2026-10-29T19:00:00"]
  ])("supports fractional-hour offsets and local rollover in %s", (timeZone, offset, start, end) => {
    expect(validateAppointmentWindow({ timeZone,
      start: time("2026-10-29T18:00:00Z", start, offset),
      end: time("2026-10-29T19:00:00Z", end, offset)
    }).start.timeZone).toBe(timeZone);
  });

  it("preserves milliseconds and freezes a detached result", () => {
    const value = fixture();
    value.start = time("2026-10-29T22:00:00.123Z", "2026-10-29T18:00:00.123", -240);
    const result = validateAppointmentWindow(value);
    value.start.instant = "changed";
    expect(result.start.dateTime).toBe("2026-10-29T22:00:00.123Z");
    expect(Object.isFrozen(result) && Object.isFrozen(result.start) && Object.isFrozen(result.end)).toBe(true);
  });

  it.each([null, [], {}, { ...fixture(), extra: true }, { ...fixture(), end: null }])("rejects a malformed or expanded window %#", value => {
    expect(() => validateAppointmentWindow(value)).toThrow("CALENDAR_APPOINTMENT_TIME_INVALID");
  });

  it.each(["+05:30", "US/Unknown", "", " UTC", "America/Indiana/Indianapolis\n", "America/Indiana/Indianapolis?secret"])("rejects an invalid zone %s", timeZone => {
    expect(() => validateAppointmentWindow({ ...fixture(), timeZone })).toThrow("CALENDAR_APPOINTMENT_TIME_INVALID");
  });

  it.each([
    { instant: "2026-02-30T22:00:00Z", localDateTime: "2026-02-30T17:00:00", offsetMinutes: -300 },
    { instant: "2026-10-29T22:00:00-04:00" },
    { instant: "2026-10-29T22:00:00Z\n" },
    { instant: "2026-10-29T22:00:00.1234Z" },
    { instant: "2026-10-29T24:00:00Z" },
    { localDateTime: "2026-10-29T18:00" },
    { localDateTime: "2026-10-29T18:00:00.001" },
    { localDateTime: "2026-10-29T18:00:00\n" },
    { offsetMinutes: -300 }, { offsetMinutes: -240.5 }, { offsetMinutes: "-240" },
    { offsetMinutes: null }, { offsetMinutes: Number.NaN }, { offsetMinutes: 841 },
    { extra: "private" }
  ])("refuses mismatched or normalized start facts %#", patch => {
    const value = fixture();
    expect(() => validateAppointmentWindow({ ...value, start: { ...value.start, ...patch } })).toThrow("CALENDAR_APPOINTMENT_TIME_INVALID");
  });

  it.each(["same", "earlier", "missing", "invalid-offset"])("rejects an invalid end: %s", kind => {
    const value = fixture();
    const end = kind === "missing" ? undefined : kind === "invalid-offset" ? { ...value.end, offsetMinutes: -300 } :
      kind === "same" ? value.start : time("2026-10-29T21:00:00Z", "2026-10-29T17:00:00", -240);
    expect(() => validateAppointmentWindow({ ...value, end })).toThrow("CALENDAR_APPOINTMENT_TIME_INVALID");
  });
});
