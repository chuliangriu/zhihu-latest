import "dotenv/config";
import { loadConfig } from "../config.js";
import { DiscoveryRuntime } from "../runtime.js";

const fixtureSet = process.argv[2] ?? "feedback-across-domains";
const config = loadConfig();
const runtime = new DiscoveryRuntime(config);

const result = await runtime.evaluate({ fixtureSet });
console.log(JSON.stringify(result, null, 2));
if (result.status === "unavailable") process.exitCode = 2;
