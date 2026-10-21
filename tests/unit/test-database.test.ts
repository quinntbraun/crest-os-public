import { describe, expect, it } from "vitest";
import { testDatabaseConnection } from "../../src/tooling/test-database.ts";

describe("disposable database safety boundary", () => {
  const local = "postgresql://postgres:crest_local_test_only@127.0.0.1:54322/crest_test";
  it("accepts an explicitly selected loopback test database", () => {
    expect(testDatabaseConnection("test", local)).toBe(local);
  });
  it.each([undefined, "local", "production", "staging"])("rejects environment %s", (environment) => {
    expect(() => testDatabaseConnection(environment, local)).toThrow("Explicit test");
  });
  it.each([undefined, "not a URL", "postgresql://user:private@db.example.com/crest_test", "postgresql://localhost/postgres", "postgresql://localhost/crest_test?host=db.example.com", "postgresql://localhost/crest_test#fragment", "https://localhost/crest_test"])("rejects unsafe or ambiguous target %s", (url) => {
    expect(() => testDatabaseConnection("test", url)).toThrow();
  });
});
