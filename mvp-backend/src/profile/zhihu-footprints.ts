import { createDecipheriv, createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { isZhihuUrl } from "../guards/candidates.js";
import { PROFILE_FOOTPRINT_LIMIT_PER_KIND, PROFILE_FOOTPRINT_LOOKBACK_YEARS, DEFAULT_ZHIHU_DATA_POLICY, type ZhihuDataPolicy } from "./footprint-policy.js";
import type { SupabaseAdapter } from "../sources/supabase-adapter.js";
import type { AccessSecretCheck, Footprint, FootprintSource, ProfileConnectionDiagnostic, ProfileSources } from "./contracts.js";

import { InMemoryProfileRequestGate, type ProfileRequestGate, type GateDecision } from "./request-gate.js";

export class ProfileDataError extends Error {
  constructor(public readonly code: string, public readonly connection?: ProfileConnectionDiagnostic,
    public readonly progress?: { footprints: Footprint[]; sources: ProfileSources }, public readonly retryAfterSeconds?: number) { super(code); }
}
interface SourceOptions { gate?: ProfileRequestGate; policy?: Partial<ZhihuDataPolicy>; }
interface CacheEntry { expires: number; records: Footprint[]; }

export function decryptProfileToken(value: string, secret: string): string {
  try {
    if (secret.length < 32) throw new Error();
    const parts = value.split(".");
    if (parts.length !== 4 || parts[0] !== "v1" || parts.slice(1).some(x => !/^[A-Za-z0-9_-]+$/.test(x))) throw new Error();
    const iv = Buffer.from(parts[1]!, "base64url"), tag = Buffer.from(parts[2]!, "base64url");
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv);
    decipher.setAuthTag(tag);
    const token = Buffer.concat([decipher.update(Buffer.from(parts[3]!, "base64url")), decipher.final()]).toString("utf8");
    if (!token || /[\r\n]/.test(token)) throw new Error();
    return token;
  } catch { throw new ProfileDataError("OAUTH_TOKEN_UNAVAILABLE"); }
}

export class ZhihuFootprintSource implements FootprintSource {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<Footprint[]>>();
  private readonly gate: ProfileRequestGate;
  private readonly policy: ZhihuDataPolicy;
  private readonly gateKey: string;
  constructor(private readonly accounts: Pick<SupabaseAdapter, "oauthAccount">,
    private readonly accessSecret: string, private readonly encryptionKey: string, private readonly fetcher: typeof fetch = fetch,
    options: SourceOptions = {}) {
    this.gate = options.gate ?? new InMemoryProfileRequestGate();
    this.policy = { ...DEFAULT_ZHIHU_DATA_POLICY, ...options.policy };
    this.gateKey = createHash("sha256").update(accessSecret).digest("hex").slice(0,32);
  }
  // Independent public request: validates the server credential without reading
  // the developer's personal data or using a rejected OAuth token as a fallback.
  async checkAccessSecret(signal: AbortSignal): Promise<AccessSecretCheck> {
    const url = new URL("https://developer.zhihu.com/api/v1/content/zhihu_search");
    url.searchParams.set("Query", "知乎"); url.searchParams.set("Count", "1");
    try {
      const response = await this.fetcher(url, { headers: { Authorization: `Bearer ${this.accessSecret}`,
        "X-Request-Timestamp": String(Math.floor(Date.now()/1000)), "Content-Type": "application/json" },
        signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]), redirect: "error" });
      let payload: any;
      try { payload = await readBody(response); } catch {}
      const upstreamCode = typeof payload?.Code === "number" && Number.isSafeInteger(payload.Code) ? payload.Code : undefined;
      return { status: response.ok && upstreamCode === 0 ? "accepted" : [401,403].includes(response.status) || upstreamCode === 20001 ? "rejected" : "unavailable",
        httpStatus: response.status, ...(upstreamCode === undefined ? {} : { upstreamCode }) };
    } catch { return { status: "unavailable" }; }
  }
  async load(userId: string, signal: AbortSignal, onRequest: () => void): Promise<Footprint[]> {
    if (!this.accessSecret || !this.encryptionKey) throw new ProfileDataError("PROFILE_CONFIG_MISSING");
    const account = await this.accounts.oauthAccount(userId, signal);
    if (!account) throw new ProfileDataError("OAUTH_REAUTH_REQUIRED", { stage: "account_lookup" });
    let token: string;
    try { token = decryptProfileToken(account.access_token, this.encryptionKey); }
    catch { throw new ProfileDataError("OAUTH_TOKEN_UNAVAILABLE", { stage: "token_decryption" }); }
    // Resolve/decrypt the current authorization before using a cache. A token change
    // gets a different cache key; no data is shared across users or credentials.
    const key = createHash("sha256").update(`${userId}\0${token}`).digest("hex");
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const work = this.readKinds(key, token, signal, onRequest);
    this.inflight.set(key,work);
    try { return await work; } finally { this.inflight.delete(key); }
  }
  private async readKinds(key: string, token: string, signal: AbortSignal, onRequest: () => void): Promise<Footprint[]> {
    const records: Footprint[] = [];
    const sources: ProfileSources = { creation: "not_requested", collection: "not_requested" };
    for (const kind of ["creation", "collection"] as const) {
      try {
        const now = Date.now(), cacheKey = `${key}:${kind}`;
        // Drop expired private content, including entries for other callers.
        for (const [entryKey, entry] of this.cache) if (entry.expires <= now) this.cache.delete(entryKey);
        const cached = this.cache.get(cacheKey);
        let items: Footprint[];
        if (cached) items = cached.records;
        else {
          const decision = await this.gate.reserve(this.gateKey, now, this.policy.minIntervalMs);
          this.assertGate(decision, kind);
          if (decision.waitMs) await delay(decision.waitMs, undefined, { signal });
          // Another in-flight request may have received a limit while we waited.
          this.assertGate(await this.gate.check(this.gateKey, Date.now()), kind);
          signal.throwIfAborted();
          const url = new URL(kind === "creation" ? "https://developer.zhihu.com/api/v1/user/contents" : "https://developer.zhihu.com/api/v1/user/collections");
          url.searchParams.set("Limit", String(PROFILE_FOOTPRINT_LIMIT_PER_KIND));
          if (kind === "creation") {
            url.searchParams.set("ContentType", "all"); url.searchParams.set("SortField", "ts"); url.searchParams.set("SortOrder", "desc");
          }
          onRequest();
          let response: Response;
          try {
            response = await this.fetcher(url, { headers: { Authorization: `Bearer ${this.accessSecret}`,
              "X-OAuth-Token": token, "X-Request-Timestamp": String(Math.floor(Date.now()/1000)), "Content-Type": "application/json" },
              signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]), redirect: "error" });
          } catch { throw new ProfileDataError("ZHIHU_USER_DATA_UNAVAILABLE", { stage: kind }); }
          let payload: any;
          try { payload = await readBody(response); }
          catch { if (response.ok) throw new ProfileDataError("ZHIHU_RESPONSE_INVALID", { stage: kind, httpStatus: response.status }); }
          const connection: ProfileConnectionDiagnostic = { stage: kind, httpStatus: response.status,
            ...(typeof payload?.Code === "number" && Number.isSafeInteger(payload.Code) ? { upstreamCode: payload.Code } : {}),
            hint: upstreamHint(payload?.Message) };
          let code: string | undefined;
          if ([401,403].includes(response.status) || payload?.Code === 20001) code = connection.hint === "access_secret_rejected" ? "ZHIHU_ACCESS_SECRET_REJECTED" : "OAUTH_REAUTH_REQUIRED";
          else if (payload?.Code === 30002) code = "ZHIHU_QUOTA_EXCEEDED";
          else if (response.status === 429 || payload?.Code === 30001) code = "ZHIHU_RATE_LIMITED";
          else if (!response.ok || payload?.Code !== 0) code = "ZHIHU_USER_DATA_UNAVAILABLE";
          if (code) {
            if (code === "ZHIHU_RATE_LIMITED" || code === "ZHIHU_QUOTA_EXCEEDED") {
              const cooldown = code === "ZHIHU_QUOTA_EXCEEDED" ? this.policy.quotaCooldownMs : this.policy.cooldownMs;
              const seconds = Math.max(Math.ceil(cooldown/1000), retryAfterSeconds(response.headers.get("retry-after"), Date.now()) ?? 0);
              await this.gate.block(this.gateKey, Date.now()+seconds*1000, code, Date.now());
              throw new ProfileDataError(code, connection, undefined, seconds);
            }
            throw new ProfileDataError(code, connection);
          }
          if (!Array.isArray(payload.Data?.Items)) throw new ProfileDataError("ZHIHU_RESPONSE_INVALID", connection);
          items = parseItems(payload.Data.Items,kind);
          if (this.policy.cacheTtlMs > 0) {
            if (this.cache.size >= 256) this.cache.delete(this.cache.keys().next().value!);
            this.cache.set(cacheKey,{ expires: Date.now()+this.policy.cacheTtlMs, records: items });
          }
        }
        const cutoff = new Date(Date.now()); cutoff.setUTCFullYear(cutoff.getUTCFullYear()-PROFILE_FOOTPRINT_LOOKBACK_YEARS);
        records.push(...items.filter(item => Date.parse(item.occurredAt) >= cutoff.getTime()));
        sources[kind] = "read";
      } catch (error) {
        sources[kind] = "failed";
        const failure = error instanceof ProfileDataError ? error : new ProfileDataError(signal.aborted ? "ZHIHU_USER_DATA_UNAVAILABLE" : "PROFILE_THROTTLE_UNAVAILABLE",{stage:kind});
        if (["OAUTH_REAUTH_REQUIRED","ZHIHU_ACCESS_SECRET_REJECTED"].includes(failure.code)) {
          this.cache.delete(`${key}:creation`); this.cache.delete(`${key}:collection`);
        }
        throw new ProfileDataError(failure.code,failure.connection,{ footprints: numberRecords(records), sources },failure.retryAfterSeconds);
      }
    }
    return numberRecords(records);
  }
  private assertGate(decision: GateDecision, kind: "creation" | "collection") {
    if (decision.blocked) throw new ProfileDataError(decision.blocked.code, {stage:kind}, undefined,
      Math.max(1, Math.ceil((decision.blocked.until-Date.now())/1000)));
  }

}
function plain(value: unknown, limit: number) { return typeof value === "string" ? value.replace(/<[^>]*>/g," ").trim().slice(0,limit) : ""; }
async function readBody(response: Response): Promise<any> {
  const reader = response.body?.getReader(); if (!reader) throw new ProfileDataError("ZHIHU_RESPONSE_INVALID");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) { const next = await reader.read(); if (next.done) break; length += next.value.length;
      if (length > 524288) { await reader.cancel(); throw new Error(); } chunks.push(next.value); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { throw new ProfileDataError("ZHIHU_RESPONSE_INVALID"); }
}

// Reduce upstream text to a fixed hint; never echo messages, bodies, credentials or URLs.
function upstreamHint(value: unknown): NonNullable<ProfileConnectionDiagnostic["hint"]> {
  if (typeof value !== "string") return "unspecified";
  if (/(?:app(?:lication)?[ _-]?(?:id)?|应用).{0,50}(?:mismatch|not match|不匹配|不一致)/iu.test(value)) return "application_mismatch";
  if (/(?:access[ _-]?(?:secret|key)).{0,50}(?:invalid|expired|incorrect|无效|失效|错误)/iu.test(value)) return "access_secret_rejected";
  if (/(?:oauth|token|令牌).{0,50}(?:invalid|expired|revoked|无效|失效|过期|撤销)/iu.test(value)) return "oauth_rejected";
  if (/permission denied|insufficient scope|权限不足|无权限|未授权/iu.test(value)) return "permission_denied";
  return "unspecified";
}

function numberRecords(records: Footprint[]) { return records.map((record,i) => ({ ...record, id: `footprint-${i+1}` })); }
function parseItems(items: any[], kind: "creation" | "collection"): Footprint[] {
  const records: Footprint[] = [], seen = new Set<string>(), now = Date.now();
  const cutoff = new Date(now); cutoff.setUTCFullYear(cutoff.getUTCFullYear()-PROFILE_FOOTPRINT_LOOKBACK_YEARS);
  for (const item of items.slice(0, PROFILE_FOOTPRINT_LIMIT_PER_KIND)) {
    const timestamp = kind === "creation" ? item?.CreatedAt : item?.FavTime;
    if (!Number.isFinite(timestamp) || timestamp*1000 < cutoff.getTime() || timestamp*1000 > now+60000 || !isZhihuUrl(item?.Url)) continue;
    const key = item.Url.split("?")[0]; if (seen.has(key)) continue;
    const title = plain(item.Title,160), summary = plain(item.Summary,700);
    if (!title && !summary) continue;
    seen.add(key); records.push({ id: "", kind, title, summary, occurredAt: new Date(timestamp*1000).toISOString() });
  }
  return records;
}
function retryAfterSeconds(value: string | null, now: number): number | undefined {
  if (!value?.trim()) return undefined;
  const seconds = /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : (Date.parse(value)-now)/1000;
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : undefined;
}
