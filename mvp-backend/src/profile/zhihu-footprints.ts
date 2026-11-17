import { createDecipheriv, createHash } from "node:crypto";
import { isZhihuUrl } from "../guards/candidates.js";
import type { SupabaseAdapter } from "../sources/supabase-adapter.js";
import type { Footprint, FootprintSource } from "./contracts.js";

export class ProfileDataError extends Error { constructor(public readonly code: string) { super(code); } }
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
  async load(userId: string, signal: AbortSignal, onRequest: () => void): Promise<Footprint[]> {
    if (!this.accessSecret || !this.encryptionKey) throw new ProfileDataError("PROFILE_CONFIG_MISSING");
    const account = await this.accounts.oauthAccount(userId, signal);
    if (!account) throw new ProfileDataError("OAUTH_REAUTH_REQUIRED");
    const token = decryptProfileToken(account.access_token, this.encryptionKey);
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
      } catch { throw new ProfileDataError("ZHIHU_USER_DATA_UNAVAILABLE"); }
      if (!response.ok) throw new ProfileDataError([401,403].includes(response.status) ? "OAUTH_REAUTH_REQUIRED" : response.status === 429 ? "ZHIHU_RATE_LIMITED" : "ZHIHU_USER_DATA_UNAVAILABLE");
      const payload = await readBody(response);
      if (payload.Code !== 0) throw new ProfileDataError(payload.Code === 20001 ? "OAUTH_REAUTH_REQUIRED" : [30001,30002].includes(payload.Code) ? "ZHIHU_RATE_LIMITED" : "ZHIHU_USER_DATA_UNAVAILABLE");
      if (!Array.isArray(payload.Data?.Items)) throw new ProfileDataError("ZHIHU_RESPONSE_INVALID");
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
