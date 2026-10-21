// Mandatory database checks use flat pgTAP output. Empty, skipped or unfinished
// suites must never be reported as executed integrity/security evidence.
export function validateTapOutput(output: readonly string[]): string[] {
  const lines = output.flatMap((value) => value.split(/\r?\n/)).map((line) => line.trim()).filter(Boolean);
  const plans = lines.filter((line) => /^1\.\./.test(line));
  const plan = plans[0]?.match(/^1\.\.([1-9]\d*)$/);
  if (plans.length !== 1 || !plan || !Number.isSafeInteger(Number(plan[1]))) {
    throw new Error("Database TAP requires exactly one non-empty test plan");
  }
  const assertions: number[] = [];
  for (const line of lines) {
    if (/^(?:not ok\b|Bail out!|#\s*(?:Looks like|Failed))/i.test(line)) {
      throw new Error("Database TAP reports a failed assertion or bailout");
    }
    if (/\s#\s*(?:SKIP|TODO)\b/i.test(line)) {
      throw new Error("Mandatory database assertions cannot be skipped or marked TODO");
    }
    const assertion = line.match(/^ok\s+(\d+)(?:\s|$)/);
    if (assertion) {
      assertions.push(Number(assertion[1]));
    } else if (!line.startsWith("#") && line !== plans[0] && line !== "TAP version 13") {
      throw new Error("Malformed database TAP output");
    }
  }
  if (assertions.length !== Number(plan[1]) || assertions.some((number, index) => number !== index + 1)) {
    throw new Error("Database TAP assertions must execute exactly once in planned order");
  }
  return lines;
}
