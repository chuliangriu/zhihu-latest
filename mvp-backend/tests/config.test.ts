import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("public deployment guard", () => {
  it("allows keychain CLI only on loopback development, never production",()=>{
    const local={ZHIHU_PUBLIC_SEARCH_ENABLED:"true",ZHIHU_PUBLIC_SEARCH_TRANSPORT:"local_cli",ZHIHU_CLI_PATH:"/trusted/zhihu-cli"};
    expect(loadConfig(local).publicSearchEnabled).toBe(true);
    expect(()=>loadConfig({...local,NODE_ENV:"production"})).toThrow(/loopback development/);
    expect(()=>loadConfig({...local,HOST:"0.0.0.0"})).toThrow(/loopback development/);
    expect(()=>loadConfig({...local,ZHIHU_CLI_PATH:"zhihu-cli"})).toThrow(/absolute CLI path/);
    expect(()=>loadConfig({ZHIHU_PUBLIC_SEARCH_ENABLED:"true"})).toThrow(/ZHIHU_ACCESS_SECRET/);
    expect(loadConfig({}).publicDemoTimeEnabled).toBe(false);
  });
  it("blocks public deployment until shared limits, identity and explicit unlock exist", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        PUBLIC_DEPLOYMENT: "true",
        APP_API_TOKEN: "production-token-with-enough-length"
      })
    ).toThrow(/blocked until security requirements/);
  });

  it("does not expose a non-loopback listener without access control", () => {
    expect(() => loadConfig({ HOST: "0.0.0.0" })).toThrow(/requires APP_API_TOKEN/);
  });

  it("requires credentials before enabling a live model", () => {
    expect(() => loadConfig({ LLM_MODE: "live" })).toThrow(/requires LLM_API_KEY and LLM_MODEL/);
  });

  it("rejects an LLM provider host outside the server allowlist", () => {
    expect(() => loadConfig({ LLM_BASE_URL: "https://attacker.example/v1" })).toThrow(/LLM_ALLOWED_HOSTS/);
  });
});
