import { verifyCiResults } from "../src/tooling/ci-results.ts";

verifyCiResults(process.env.CREST_CI_NEEDS);
console.log("Every required database, authentication and browser group succeeded");
