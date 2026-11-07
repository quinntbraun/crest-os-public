/** Offline validation only. Never resolve an ambiguous local time by guessing an offset. */
export type ReviewedAppointmentTime = Readonly<{
  instant: string;
  localDateTime: string;
  offsetMinutes: number;
}>;

export type ReviewedAppointmentWindow = Readonly<{
  timeZone: string;
  start: ReviewedAppointmentTime;
  end: ReviewedAppointmentTime;
}>;

export type ValidatedAppointmentWindow = Readonly<{
  start: Readonly<{ dateTime: string; timeZone: string }>;
  end: Readonly<{ dateTime: string; timeZone: string }>;
}>;

const dateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?$/;

function invalid(): never {
  // Deliberately do not include private input values in diagnostic messages.
  throw new Error("CALENDAR_APPOINTMENT_TIME_INVALID");
}

function exactObject(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some(key => typeof key !== "string" || !keys.includes(key))) invalid();
}

function reviewedInstant(value: unknown, formatter: Intl.DateTimeFormat): number {
  exactObject(value, ["instant", "localDateTime", "offsetMinutes"]);
  const { instant, localDateTime, offsetMinutes } = value;
  if (typeof instant !== "string" || !instant.endsWith("Z") || !dateTimePattern.test(instant.slice(0, -1)) ||
      typeof localDateTime !== "string" || !dateTimePattern.test(localDateTime) ||
      typeof offsetMinutes !== "number" || !Number.isInteger(offsetMinutes) || Math.abs(offsetMinutes) > 840) invalid();
  const millis = Date.parse(instant);
  const localMillis = Date.parse(`${localDateTime}Z`);
  if (!Number.isFinite(millis) || !Number.isFinite(localMillis)) invalid();
  const date = new Date(millis);
  const local = new Date(localMillis);
  const canonical = (text: string) => text.length === 19 ? `${text}.000` : text;
  // Date.parse silently normalizes February 30; require exact calendar dates.
  if (date.getUTCFullYear() < 1 || local.getUTCFullYear() < 1 ||
      date.toISOString() !== `${canonical(instant.slice(0, -1))}Z` ||
      local.toISOString() !== `${canonical(localDateTime)}Z` ||
      localMillis - millis !== offsetMinutes * 60_000) invalid();
  const parts = formatter.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === type)?.value ?? "";
  const actual = `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
  if (actual !== localDateTime.slice(0, 19)) invalid();
  return millis;
}

/** Both endpoints must match their original zone and individually reviewed offset. */
export function validateAppointmentWindow(value: unknown): ValidatedAppointmentWindow {
  exactObject(value, ["timeZone", "start", "end"]);
  const { timeZone } = value;
  // Exclude numeric-offset zones, whose acceptance varies between ICU releases.
  if (typeof timeZone !== "string" || timeZone.length > 100 ||
      !/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/.test(timeZone)) invalid();
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA-u-ca-iso8601-nu-latn", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
    });
  } catch { invalid(); }
  const start = reviewedInstant(value.start, formatter);
  const end = reviewedInstant(value.end, formatter);
  if (end <= start) invalid();
  return Object.freeze({
    start: Object.freeze({ dateTime: new Date(start).toISOString(), timeZone }),
    end: Object.freeze({ dateTime: new Date(end).toISOString(), timeZone })
  });
}
