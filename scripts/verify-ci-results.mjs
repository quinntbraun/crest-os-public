import { verifyCiResults } from "../src/tooling/ci-results.ts";

verifyCiResults(process.env.CREST_CI_NEEDS);
console.log("Every required database and authentication group succeeded");
