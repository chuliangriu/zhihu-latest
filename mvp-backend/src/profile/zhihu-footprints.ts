import { createDecipheriv, createHash } from "node:crypto";
import { isZhihuUrl } from "../guards/candidates.js";
import type { SupabaseAdapter } from "../sources/supabase-adapter.js";
import type { AccessSecretCheck, Footprint, FootprintSource, ProfileConnectionDiagnostic } from "./contracts.js";

export class ProfileDataError extends Error {
  constructor(public readonly code: string, public readonly connection?: ProfileConnectionDiagnostic) { super(code); }
}
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
  constructor(private readonly accounts: Pick<SupabaseAdapter, "oauthAccount">,
    private readonly accessSecret: string, private readonly encryptionKey: string, private readonly fetcher: typeof fetch = fetch) {}
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
    const records: Footprint[] = [];
    const now = Date.now();
    const seen = new Set<string>();
    for (const kind of ["creation", "collection"] as const) {
      const url = new URL(kind === "creation" ? "https://developer.zhihu.com/api/v1/user/contents" : "https://developer.zhihu.com/api/v1/user/collections");
      url.searchParams.set("Limit", "8");
      if (kind === "creation") {
        url.searchParams.set("ContentType", "all"); url.searchParams.set("SortField", "ts"); url.searchParams.set("SortOrder", "desc");
      }
      onRequest();
      let response: Response;
      try {
        response = await this.fetcher(url, { headers: { Authorization: `Bearer ${this.accessSecret}`,
          "X-OAuth-Token": token, "X-Request-Timestamp": String(Math.floor(now/1000)), "Content-Type": "application/json" },
          signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]), redirect: "error" });
      } catch { throw new ProfileDataError("ZHIHU_USER_DATA_UNAVAILABLE", { stage: kind }); }
      let payload: any;
      try { payload = await readBody(response); }
      catch { if (response.ok) throw new ProfileDataError("ZHIHU_RESPONSE_INVALID", { stage: kind, httpStatus: response.status }); }
      const connection: ProfileConnectionDiagnostic = { stage: kind, httpStatus: response.status,
        ...(typeof payload?.Code === "number" && Number.isSafeInteger(payload.Code) ? { upstreamCode: payload.Code } : {}),
        hint: upstreamHint(payload?.Message) };
      if (!response.ok) throw new ProfileDataError([401,403].includes(response.status) ? "OAUTH_REAUTH_REQUIRED" : response.status === 429 ? "ZHIHU_RATE_LIMITED" : "ZHIHU_USER_DATA_UNAVAILABLE", connection);
      if (payload?.Code !== 0) throw new ProfileDataError(payload?.Code === 20001 ? "OAUTH_REAUTH_REQUIRED" : [30001,30002].includes(payload?.Code) ? "ZHIHU_RATE_LIMITED" : "ZHIHU_USER_DATA_UNAVAILABLE", connection);
      if (!Array.isArray(payload.Data?.Items)) throw new ProfileDataError("ZHIHU_RESPONSE_INVALID", connection);
      for (const item of payload.Data.Items.slice(0,8)) {
        const timestamp = kind === "creation" ? item.CreatedAt : item.FavTime;
        if (!Number.isFinite(timestamp) || timestamp * 1000 < now - 90 * 86400000 || timestamp * 1000 > now + 60000 || !isZhihuUrl(item.Url)) continue;
        const key = `${kind}:${item.Url.split("?")[0]}`; if (seen.has(key)) continue;
        const title = plain(item.Title,160), summary = plain(item.Summary,700);
        if (!title && !summary) continue;
        seen.add(key); records.push({ id: `footprint-${records.length+1}`, kind, title, summary, occurredAt: new Date(timestamp*1000).toISOString() });
      }
    }
    return records;
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
