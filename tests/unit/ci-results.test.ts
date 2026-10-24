import { describe, expect, it } from "vitest";
import { verifyCiResults } from "../../src/tooling/ci-results.ts";

const successful = () => ({
  database_foundation: { result: "success", outputs: {} },
  database_provider: { result: "success", outputs: {} },
  authentication: { result: "success", outputs: {} }
});

describe("required CI prerequisite gate", () => {
  it("accepts all three completed groups, independent of property order", () => {
    const needs = successful();
    expect(() => verifyCiResults(JSON.stringify({
      authentication: needs.authentication,
      database_provider: needs.database_provider,
      database_foundation: needs.database_foundation
    }))).not.toThrow();
  });

  for (const job of Object.keys(successful()) as (keyof ReturnType<typeof successful>)[]) {
    it.each(["failure", "cancelled", "skipped", "pending", "SUCCESS"])(
      `rejects ${job} with result %s`, result => {
        const needs = successful();
        needs[job].result = result;
        expect(() => verifyCiResults(JSON.stringify(needs))).toThrow("CI prerequisites did not all succeed");
      }
    );
    it(`rejects a missing ${job} rather than passing a partial set`, () => {
      const needs: Record<string, unknown> = successful();
      delete needs[job];
      expect(() => verifyCiResults(JSON.stringify(needs))).toThrow();
    });
    it.each([null, "success", [], {}, { result: true }])(`rejects malformed ${job}: %j`, value => {
      expect(() => verifyCiResults(JSON.stringify({ ...successful(), [job]: value }))).toThrow();
    });
  }

  it("rejects unexpected job names even when all expected groups succeeded", () => {
    expect(() => verifyCiResults(JSON.stringify({ ...successful(), unreviewed: { result: "success" } }))).toThrow();
  });
  it.each([undefined, "", "not json", "null", "[]", '"success"', "{}"])(
    "rejects absent or invalid needs JSON: %j", json => {
      expect(() => verifyCiResults(json)).toThrow("CI prerequisites did not all succeed");
    }
  );
});
