import { validateAppointmentWindow, type ReviewedAppointmentWindow } from "./appointment-time";

/** Payload preview, not authentication, consent persistence, or dispatch authority. */
export type CalendarProjectionInput = Readonly<{
  schemaVersion: 1;
  eventIdentity: string;
  jobReference: string;
  appointmentVersion: string;
  appointmentState: "confirmed" | "completed";
  window: ReviewedAppointmentWindow;
  consent: Readonly<{
    version: string;
    clientDisplayName: boolean;
    serviceLabel: boolean;
    workAddress: boolean;
  }>;
  optionalFields: Readonly<{
    clientDisplayName: string | null;
    serviceLabel: string | null;
    workAddress: string | null;
  }>;
}>;

export type CalendarEventProjection = Readonly<{
  id: string;
  summary: string;
  description: string;
  location: string;
  start: Readonly<{ dateTime: string; timeZone: string }>;
  end: Readonly<{ dateTime: string; timeZone: string }>;
  visibility: "private";
  transparency: "opaque";
  reminders: Readonly<{ useDefault: false; overrides: readonly [] }>;
  source: Readonly<{ title: "Crest OS"; url: string }>;
  extendedProperties: Readonly<{ private: Readonly<{
    crestProjection: "1";
    crestJobReference: string;
    crestAppointmentVersion: string;
    crestConsentVersion: string;
  }> }>;
}>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const versionPattern = /^[1-9][0-9]{0,18}$/;

function invalid(): never { throw new Error("CALENDAR_PROJECTION_INVALID"); }

function exactObject(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some(key => typeof key !== "string" || !keys.includes(key))) invalid();
}

function version(value: unknown): asserts value is string {
  if (typeof value !== "string" || !versionPattern.test(value) || BigInt(value) > 9223372036854775807n) invalid();
}

function selectedText(value: unknown, selected: unknown, max: number): string | null {
  if (typeof selected !== "boolean" || (value !== null && typeof value !== "string")) invalid();
  // Unselected source values must never enter a provider payload, even as diagnostics.
  if (!selected) return null;
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\uD800-\uDFFF]/u.test(value) ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)) invalid();
  return value;
}

function htmlText(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function applicationOrigin(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) invalid();
  let url: URL;
  try { url = new URL(value); } catch { invalid(); }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" ||
      url.search || url.hash || (value !== url.origin && value !== `${url.origin}/`)) invalid();
  return url.origin;
}

/**
 * Build exactly the previewed fields. The caller must persist the mapping UUID once per
 * job/destination and retain it across versions, retries, recovery epochs and consent edits.
 * This pure function cannot prove confirmed source, connection, or authority; future trusted
 * scheduling/dispatch must obtain those from the database and check all GC01–GC18 fences.
 */
export function buildCalendarEventProjection(input: unknown, trustedApplicationOrigin: string): CalendarEventProjection {
  exactObject(input, ["schemaVersion", "eventIdentity", "jobReference", "appointmentVersion", "appointmentState", "window", "consent", "optionalFields"]);
  if (input.schemaVersion !== 1 || typeof input.eventIdentity !== "string" || !uuidPattern.test(input.eventIdentity) ||
      typeof input.jobReference !== "string" || !uuidPattern.test(input.jobReference)) invalid();
  version(input.appointmentVersion);
  if (input.appointmentState !== "confirmed" && input.appointmentState !== "completed") invalid();
  exactObject(input.consent, ["version", "clientDisplayName", "serviceLabel", "workAddress"]);
  exactObject(input.optionalFields, ["clientDisplayName", "serviceLabel", "workAddress"]);
  version(input.consent.version);
  const client = selectedText(input.optionalFields.clientDisplayName, input.consent.clientDisplayName, 200);
  const service = selectedText(input.optionalFields.serviceLabel, input.consent.serviceLabel, 300);
  const address = selectedText(input.optionalFields.workAddress, input.consent.workAddress, 1000);
  const window = validateAppointmentWindow(input.window);
  const url = `${applicationOrigin(trustedApplicationOrigin)}/jobs/${input.jobReference}`;
  // description accepts HTML in Google; escape selected text instead of injecting markup.
  const description = `Crest job reference: ${input.jobReference}\nOpen Crest OS: ${htmlText(url)}` +
    (service === null ? "" : `\nService: ${htmlText(service)}`);
  return Object.freeze({
    id: input.eventIdentity.replaceAll("-", ""),
    summary: client === null ? "Crest job" : `Crest job — ${client}`,
    description,
    // Send empty location explicitly so disabling address sharing clears a prior projection.
    location: address ?? "",
    start: window.start,
    end: window.end,
    visibility: "private",
    transparency: "opaque",
    reminders: Object.freeze({ useDefault: false, overrides: Object.freeze([] as const) }),
    source: Object.freeze({ title: "Crest OS", url }),
    extendedProperties: Object.freeze({ private: Object.freeze({
      crestProjection: "1",
      crestJobReference: input.jobReference,
      crestAppointmentVersion: input.appointmentVersion,
      crestConsentVersion: input.consent.version
    }) })
  });
}
