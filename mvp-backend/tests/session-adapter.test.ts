import { createHash } from "node:crypto";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { SupabaseAdapter } from "../src/sources/supabase-adapter.js";
import { createApp } from "../src/api/app.js";
import { loadConfig } from "../src/config.js";
import { DiscoveryRuntime } from "../src/runtime.js";
const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const token = "a".repeat(43);
const principal = { userId, sessionId, role: "user" as const, status: "active" as const };
describe("colleague session integration", () => {
  it("hashes the existing cookie, checks current DB session and returns no token", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json([{ id: sessionId, user_id: userId }]))
      .mockResolvedValueOnce(Response.json([{ id: userId }]));
    const db = new SupabaseAdapter("https://project.supabase.co", "sb_secret_test-only", fetcher);
    expect(await db.session(`wjr_session=${token}`, new AbortController().signal)).toEqual(principal);
    const url = new URL(String(fetcher.mock.calls[0]![0]));
    expect(url.searchParams.get("session_hash")).toBe(`eq.${createHash("sha256").update(token).digest("hex")}`);
    expect(url.searchParams.get("revoked_at")).toBe("is.null");
    expect(url.searchParams.get("expires_at")).toMatch(/^gt\./);
    expect(url.toString()).not.toContain(token);
    expect(fetcher.mock.calls[0]![1]?.redirect).toBe("error");
  });
  it("rejects malformed/duplicate cookies before DB requests and distinguishes DB outage", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));
    const db = new SupabaseAdapter("https://project.supabase.co", "sb_secret_test-only", fetcher);
    expect(await db.session("wjr_session=%bad", AbortSignal.timeout(1000))).toBeNull();
    expect(await db.session(`wjr_session=${token}; wjr_session=${token}`, AbortSignal.timeout(1000))).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    await expect(db.session(`wjr_session=${token}`, AbortSignal.timeout(1000))).rejects.toMatchObject({ code: "DATABASE_UNAVAILABLE" });
  });
  it("checks owner, consent, expiry and source type even in a malformed DB response", async () => {
    const owner = "33333333-3333-4333-8333-333333333333";
    const expression = "44444444-4444-4444-8444-444444444444";
    const base = { expression_id: expression, owner_id: owner, matching_allowed: true, excerpt_allowed: true,
      contact_allowed: false, consented_at: new Date().toISOString(), revoked_at: null,
      discoverable_until: new Date(Date.now()+86400000).toISOString(),
      expressions: { id: expression, owner_id: owner, content: "我还在写作，也不知道有没有人想读。", context_summary: "这个人下班后一直在写小说。他反复修改章节，但很少得到读者回应。", source_type: "private_authorized", created_at: new Date().toISOString(), deleted_at: null } };
    const fetcher = vi.fn<typeof fetch>(async input => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/mailbox_papers")) return Response.json([{expression_id:expression,subject:"小说还要不要继续",background:"这个人下班后一直在写小说。他反复修改章节，但很少得到读者回应。"}]);
      if (path.endsWith("/users")) return Response.json([{id:owner,display_name:"纸条主人",profile_url:null}]);
      return Response.json([
        base, { ...base, owner_id: userId }, { ...base, revoked_at: new Date().toISOString() },
        { ...base, discoverable_until: "bad-date" }, { ...base, excerpt_allowed: false },
        { ...base, expressions: { ...base.expressions, source_type: "demo_seed" } }
      ]);
    });
    const db = new SupabaseAdapter("https://project.supabase.co", "sb_secret_test-only", fetcher);
    const found = await db.list(userId, AbortSignal.timeout(1000));
    expect(found).toHaveLength(1);
    expect(found[0]?.source.sourceType).toBe("authorized_private");
    expect(found[0]?.permission.identityDisclosable).toBe(false);
    expect(found[0]?.profileBackground).toEqual(["这个人下班后一直在写小说。", "他反复修改章节，但很少得到读者回应。"]);
    expect(found[0]?.recentFocus).toBe("小说还要不要继续");
  });
  it("loads and deduplicates recently presented candidates for viewer rotation",async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json([
      {candidate_ref:"candidate-a"},{candidate_ref:"candidate-b"},{candidate_ref:"candidate-a"}
    ]));
    const db=new SupabaseAdapter("https://project.supabase.co","sb_secret_test-only",fetcher);
    expect(await db.listRecentlyPresentedCandidateIds(userId,AbortSignal.timeout(1000))).toEqual(["candidate-a","candidate-b"]);
    const url=new URL(String(fetcher.mock.calls[0]![0]));
    expect(url.searchParams.get("viewer_id")).toBe(`eq.${userId}`);
    expect(url.searchParams.get("created_at")).toMatch(/^gte\./);
    expect(url.searchParams.get("limit")).toBe("40");
  });
  it("requires trusted cookie identity and Origin before using existing quota protection", async () => {
    const config = loadConfig({ NODE_ENV: "test", AUTH_MODE: "session", SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test-only", IP_HASH_SECRET: "test-only-ip-hash-secret-32-characters", CORS_ORIGINS: "https://app.example" });
    const runtime = new DiscoveryRuntime(config, undefined, () => undefined);
    const evaluateDetailed = vi.fn(runtime.evaluateDetailed.bind(runtime));
    const resolver = vi.fn(async (cookie: string) => cookie === `wjr_session=${token}` ? principal : null);
    const app = createApp({ config, runtime: { evaluateDetailed }, sessionResolver: resolver });
    await request(app).post("/api/discovery/evaluate").send({}).expect(403);
    await request(app).post("/api/discovery/evaluate").set("Origin", "https://app.example").send({}).expect(401);
    await request(app).post("/api/discovery/evaluate").set("Origin", "https://app.example").set("Cookie", `wjr_session=${token}`)
      .set("X-Unseen-User-Id", "forged").set("Idempotency-Key", "session-test-key-01").send({}).expect(200);
    expect(evaluateDetailed.mock.calls[0]?.[1]).toEqual(principal);
  });
});
