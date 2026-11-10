// Required CI partitions of the existing complete browser command. Each group
// owns a separate PostgreSQL cluster; files stay serial within that cluster.
const group = (...files: string[]) => Object.freeze(files.map(file => `tests/integration/${file}.test.mjs`));
export const browserGroups = Object.freeze({
  crm: group('sign-in-browser','customer-address-browser','vehicle-http-browser','association-http-browser','association-editor-browser'),
  intake: group('lead-http-browser','lead-editor-browser','lead-address-editor-browser','lead-conversion-http-browser','lead-conversion-editor-browser'),
  commercial: group('quote-draft-editor-browser','quote-review-browser','quote-commercial-browser','quote-browser-response'),
  amendments: group('quote-amendment-workspace-browser','quote-amendment-acceptance-product-browser'),
  schedule: group('appointment-holds-browser','appointment-holds-product-browser','confirmed-bookings-product-browser','book-job-product-browser','job-change-product-browser','booking-divisions-product-browser','combined-booking-product-browser','fulfillment-modes-product-browser','booking-conflict-review-product-browser','field-work-product-browser','work-completion-product-browser','mileage-product-browser','support-trip-product-browser','trip-interruption-product-browser','unfulfilled-cancellation-product-browser','job-work-time-product-browser','job-work-boundary-product-browser'),
  records: group('source-export-browser','source-export-product-browser','workspace-journey-browser','owner-expenses-product-browser')
});
export type BrowserGroup = keyof typeof browserGroups;
export function browserGroupFiles(command: unknown, selected: unknown): readonly string[] {
  const invalid = () => { throw new Error('BROWSER_GROUP_COVERAGE_REVIEW_REQUIRED'); };
  if (typeof command !== 'string' || typeof selected !== 'string' || !Object.hasOwn(browserGroups, selected)) return invalid();
  const tokens = command.trim().split(/\s+/);
  if (tokens[0] !== 'node' || tokens[1] !== '--test' || tokens[2] !== '--test-concurrency=1') return invalid();
  const declared = tokens.slice(3), expected = Object.values(browserGroups).flat();
  if (new Set(expected).size !== expected.length || new Set(declared).size !== declared.length
    || declared.length !== expected.length || declared.some(file => !expected.includes(file))) return invalid();
  return browserGroups[selected as BrowserGroup];
}
