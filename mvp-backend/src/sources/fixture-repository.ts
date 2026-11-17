import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  candidateExpressionSchema,
  fixtureSchema,
  type CandidateExpression,
  type Fixture
} from "../contracts/schemas.js";

const DEFAULT_FIXTURE_DIR = fileURLToPath(new URL("../../fixtures", import.meta.url));

export interface MaterializedFixture {
  fixture: Fixture;
  candidates: CandidateExpression[];
}

export class FixtureRepository {
  constructor(private readonly fixtureDir = DEFAULT_FIXTURE_DIR) {}

  async load(id: string): Promise<MaterializedFixture> {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) {
      throw new FixtureError("FIXTURE_ID_INVALID", "Fixture id is invalid");
    }

    const path = join(this.fixtureDir, `${id}.json`);
    if (dirname(path) !== this.fixtureDir) {
      throw new FixtureError("FIXTURE_PATH_INVALID", "Fixture path is invalid");
    }

    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      throw new FixtureError("FIXTURE_NOT_FOUND", `Fixture not found: ${id}`);
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      throw new FixtureError("FIXTURE_JSON_INVALID", `Fixture JSON is invalid: ${id}`);
    }

    const fixture = fixtureSchema.safeParse(decoded);
    if (!fixture.success) {
      throw new FixtureError("FIXTURE_SCHEMA_INVALID", `Fixture schema is invalid: ${id}`);
    }

    const now = Date.now();
    const candidates = fixture.data.candidates.map((candidate) => {
      const { ageDays, ...source } = candidate.source;
      return candidateExpressionSchema.parse({
        ...candidate,
        source: {
          ...source,
          publishedAt: new Date(now - ageDays * 86_400_000).toISOString()
        }
      });
    });

    return { fixture: fixture.data, candidates };
  }
}

export class FixtureError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "FixtureError";
  }
}
