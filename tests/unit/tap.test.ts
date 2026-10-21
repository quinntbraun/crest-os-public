import { describe, expect, it } from "vitest";
import { validateTapOutput } from "../../src/tooling/tap.ts";

describe("mandatory PostgreSQL test evidence", () => {
  it("accepts complete sequential results with pgTAP diagnostics", () => {
    const output = ["1..2", "ok 1 - restricted role", "# synthetic test fixture", "ok 2 - tenant isolation"];
    expect(validateTapOutput(output)).toEqual(output);
  });
  it("accepts a trailing plan and multiline SQL result values", () => {
    expect(validateTapOutput(["ok 1 - guard\r\n1..1\r\n"])).toEqual(["ok 1 - guard", "1..1"]);
  });
  it.each([
    { name: "no results", output: [] },
    { name: "empty plan", output: ["1..0"] },
    { name: "missing assertion", output: ["1..1"] },
    { name: "extra assertion", output: ["1..1", "ok 1", "ok 2"] },
    { name: "multiple plans", output: ["1..1", "ok 1", "1..1"] },
    { name: "skipped guard", output: ["1..1", "ok 1 - guard # SKIP unavailable"] },
    { name: "TODO guard", output: ["1..1", "ok 1 - guard # TODO implement later"] },
    { name: "failed assertion", output: ["1..1", "not ok 1 - guard"] },
    { name: "bailout", output: ["1..1", "ok 1", "Bail out! connection lost"] },
    { name: "duplicate assertion number", output: ["1..2", "ok 1 - guard", "ok 1 - guard"] },
    { name: "out-of-order assertions", output: ["1..2", "ok 2", "ok 1"] },
    { name: "failed finish diagnostic", output: ["1..1", "ok 1", "# Looks like a test failed"] },
    { name: "malformed result", output: ["1..1", "ok 1", "unrecognized output"] }
  ])("rejects $name instead of claiming a database pass", ({ output }) => {
    expect(() => validateTapOutput(output)).toThrow();
  });
});
