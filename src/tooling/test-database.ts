export function testDatabaseConnection(environment: string | undefined, value: string | undefined): string {
  if (environment !== "test" || !value) throw new Error("Explicit test environment and disposable database URL required");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Invalid test database URL"); }
  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol)
    || !new Set(["127.0.0.1", "localhost", "[::1]"]).has(url.hostname)
    || url.pathname !== "/crest_test"
    || url.search || url.hash) {
    throw new Error("Test database must be loopback-only and named crest_test, without URL options");
  }
  return value;
}
