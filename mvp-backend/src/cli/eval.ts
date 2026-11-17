import "dotenv/config";
import { loadConfig } from "../config.js";
import { DiscoveryRuntime } from "../runtime.js";
import { FixtureRepository } from "../sources/fixture-repository.js";

const fixtureIds = [
  "feedback-across-domains",
  "fact-query",
  "same-topic-rewrite",
  "unsupported-psychology",
  "invalid-evidence"
];

const config = loadConfig();
const repository = new FixtureRepository();
let failed = 0;

for (const fixtureId of fixtureIds) {
  const materialized = await repository.load(fixtureId);
  const result = await new DiscoveryRuntime(config, repository, () => undefined).evaluate({ fixtureSet: fixtureId });
  const expected = materialized.fixture.expected;
  const structureCandidate = result.matches.structureRelated?.candidateId ?? null;
  const passed =
    result.status === expected.status &&
    (expected.structureRelatedCandidateId === undefined ||
      structureCandidate === expected.structureRelatedCandidateId);
  if (!passed) failed += 1;
  console.log(
    `${passed ? "PASS" : "FAIL"} ${fixtureId}: status=${result.status}, structureRelated=${structureCandidate ?? "none"}`
  );
}

if (failed > 0) {
  console.error(`${failed} eval fixture(s) failed`);
  process.exitCode = 1;
} else {
  console.log(`${fixtureIds.length} eval fixtures passed`);
}
