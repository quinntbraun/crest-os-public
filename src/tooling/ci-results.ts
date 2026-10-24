const requiredJobs = ["database_foundation", "database_provider", "authentication"] as const;

// GitHub skips dependent jobs by default, which can appear successful to branch
// protection. The required job always runs and must reject every incomplete group.
export function verifyCiResults(json: string | undefined): void {
  let needs: unknown;
  try {
    needs = JSON.parse(json ?? "");
  } catch {
    throw new Error("CI prerequisites did not all succeed");
  }
  if (needs === null || typeof needs !== "object" || Array.isArray(needs)
    || Object.keys(needs).length !== requiredJobs.length
    || !requiredJobs.every(job => {
      if (!Object.hasOwn(needs, job)) return false;
      const value = (needs as Record<string, unknown>)[job];
      return value !== null && typeof value === "object" && !Array.isArray(value)
        && Object.hasOwn(value, "result")
        && (value as Record<string, unknown>).result === "success";
    })) {
    throw new Error("CI prerequisites did not all succeed");
  }
}
