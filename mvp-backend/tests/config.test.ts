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


describe("GLM reasoning defaults", () => {
  it("uses a larger bounded output budget and low reasoning for GLM-5.3", () => {
    const llm = loadConfig({ LLM_MODEL: "glm-5.3" }).llm;
    expect(llm.maxOutputTokens).toBe(4096);
    expect(llm.reasoningEffort).toBe("low");
    expect(loadConfig({}).llm.maxOutputTokens).toBe(1500);
    expect(loadConfig({}).llm.reasoningEffort).toBeUndefined();
  });
  it("honors explicit operator overrides", () => {
    const llm = loadConfig({ LLM_MODEL: "glm-5.3", LLM_MAX_OUTPUT_TOKENS: "2048", LLM_REASONING_EFFORT: "high" }).llm;
    expect(llm.maxOutputTokens).toBe(2048);
    expect(llm.reasoningEffort).toBe("high");
  });
});


describe("persistent session workflow storage",()=>{
  it("defaults authenticated site sessions to Supabase while keeping local signed fixtures in memory",()=>{
    const env={AUTH_MODE:"session",SUPABASE_URL:"https://project.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"synthetic-test-key"};
    expect(loadConfig(env).businessStoreMode).toBe("supabase");
    expect(loadConfig({}).businessStoreMode).toBe("memory");
    expect(loadConfig({...env,BUSINESS_STORE_MODE:"memory"}).businessStoreMode).toBe("memory");
  });
});
