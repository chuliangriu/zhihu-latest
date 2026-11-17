import { createHash } from "node:crypto";
import { z } from "zod";
import { candidateExpressionSchema, type CandidateExpression } from "../contracts/schemas.js";
import type { PrivatePool } from "./routed-source.js";
import type { AuthenticatedPrincipal } from "../security/types.js";
import { splitLimitedBackground } from "./candidate-profile.js";

export class DatabaseUnavailableError extends Error { readonly code = "DATABASE_UNAVAILABLE"; }
const mailboxProfileRow = z.object({
  expression_id: z.string().uuid(),
  subject: z.string().trim().min(1).max(24),
  background: z.string().trim().min(1).max(160)
});
const userProfileRow = z.object({
  id: z.string().uuid(),
  display_name: z.string().nullable(),
  profile_url: z.string().nullable()
});
export class SupabaseAdapter implements PrivatePool {
  private readonly base: URL;
  constructor(baseUrl: string, private readonly serviceKey: string, private readonly fetcher: typeof fetch = fetch) {
    this.base = new URL(baseUrl);
    if (this.base.protocol !== "https:" || this.base.username || this.base.password || this.base.search || this.base.hash || this.base.pathname !== "/") throw new Error("Invalid Supabase URL");
    if (!serviceKey) throw new Error("Missing Supabase service key");
  }
  private async get(table: string, query: Record<string,string>, signal: AbortSignal): Promise<unknown> {
    const url = new URL(`/rest/v1/${table}`, this.base);
    url.search = new URLSearchParams(query).toString();
    const headers: Record<string,string> = { apikey: this.serviceKey, Accept: "application/json" };
    if (!this.serviceKey.startsWith("sb_secret_")) headers.Authorization = `Bearer ${this.serviceKey}`;
    try {
      const response = await this.fetcher(url, { headers, signal, redirect: "error" });
      if (!response.ok) throw new DatabaseUnavailableError();
      return await response.json();
    } catch { throw new DatabaseUnavailableError(); }
  }
  async session(cookie: string, signal: AbortSignal): Promise<AuthenticatedPrincipal | null> {
    const tokens = cookie.split(";").map(s => s.trim()).filter(s => s.startsWith("wjr_session="));
    if (tokens.length !== 1) return null;
    const token = tokens[0]!.slice("wjr_session=".length);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const sessions = z.array(z.object({ id: z.string().uuid(), user_id: z.string().uuid() })).parse(await this.get("app_sessions", {
      session_hash: `eq.${createHash("sha256").update(token).digest("hex")}`, revoked_at: "is.null",
      expires_at: `gt.${new Date().toISOString()}`, select: "id,user_id", limit: "1"
    }, signal));
    const session = sessions[0]; if (!session) return null;
    const users = z.array(z.object({ id: z.string().uuid() })).parse(await this.get("users", { id: `eq.${session.user_id}`, select: "id", limit: "1" }, signal));
    if (!users[0] || users[0].id !== session.user_id) return null;
    return { userId: users[0].id, sessionId: session.id, role: "user", status: "active" };
  }
  async list(viewerId: string, signal: AbortSignal): Promise<CandidateExpression[]> {
    z.string().uuid().parse(viewerId);
    const now = Date.now(); const result: CandidateExpression[] = [];
    for (let offset = 0; offset < 5000; offset += 500) {
      const rows = await this.get("expression_consents", {
        select: "expression_id,owner_id,matching_allowed,excerpt_allowed,contact_allowed,identity_disclosure,discoverable_until,consented_at,revoked_at,expressions!inner(id,owner_id,content,context_summary,source_type,created_at,deleted_at)",
        owner_id: `neq.${viewerId}`, matching_allowed: "eq.true", excerpt_allowed: "eq.true", revoked_at: "is.null",
        discoverable_until: `gt.${new Date(now).toISOString()}`, consented_at: "not.is.null",
        "expressions.source_type": "eq.private_authorized", "expressions.deleted_at": "is.null",
        "expressions.created_at": `gte.${new Date(now - 7 * 86400000).toISOString()}`,
        order: "expression_id.asc", offset: String(offset), limit: "500"
      }, signal);
      if (!Array.isArray(rows)) throw new DatabaseUnavailableError();
      const expressionIds = [...new Set(rows.map(row => row?.expressions?.id).filter(id => z.string().uuid().safeParse(id).success))];
      const ownerIds = [...new Set(rows.map(row => row?.owner_id).filter(id => z.string().uuid().safeParse(id).success))];
      const paperProfiles = new Map<string,z.infer<typeof mailboxProfileRow>>();
      const userProfiles = new Map<string,z.infer<typeof userProfileRow>>();
      for (let start = 0; start < expressionIds.length; start += 100) {
        const batch = expressionIds.slice(start,start+100);
        try {
          const profiles = z.array(mailboxProfileRow).parse(await this.get("mailbox_papers", {
            expression_id: `in.(${batch.join(",")})`, status: "eq.active", select: "expression_id,subject,background"
          }, signal));
          for (const profile of profiles) paperProfiles.set(profile.expression_id,profile);
        } catch (error) {
          if (!(error instanceof DatabaseUnavailableError)) throw error;
        }
      }
      for (let start = 0; start < ownerIds.length; start += 100) {
        const batch = ownerIds.slice(start,start+100);
        try {
          const profiles = z.array(userProfileRow).parse(await this.get("users", {
            id: `in.(${batch.join(",")})`, select: "id,display_name,profile_url"
          }, signal));
          for (const profile of profiles) userProfiles.set(profile.id,profile);
        } catch (error) {
          if (!(error instanceof DatabaseUnavailableError)) throw error;
        }
      }
      for (const row of rows) {
        const e = row.expressions;
        if (!e || row.owner_id === viewerId || e.owner_id !== row.owner_id || e.id !== row.expression_id ||
          row.matching_allowed !== true || row.excerpt_allowed !== true || row.revoked_at || e.deleted_at || !row.consented_at ||
          !Number.isFinite(Date.parse(row.consented_at)) || Date.parse(row.consented_at) > now ||
          Date.parse(row.discoverable_until) <= now || !Number.isFinite(Date.parse(row.discoverable_until)) || e.source_type !== "private_authorized") continue;
        const disclose = row.identity_disclosure === "nickname" || row.identity_disclosure === "full";
        const user = userProfiles.get(row.owner_id) ?? null;
        const paperProfile = paperProfiles.get(e.id);
        const parsed = candidateExpressionSchema.safeParse({ candidateId: e.id, authorId: e.owner_id,
          authorDisplayName: disclose && typeof user?.display_name === "string" ? user.display_name : "匿名用户",
          authorProfileUrl: disclose && typeof user?.profile_url === "string" ? user.profile_url : null,
          profileBackground: splitLimitedBackground(paperProfile?.background ?? e.context_summary),
          recentFocus: paperProfile?.subject ?? null,
          domain: "private_expression", text: e.content,
          source: { sourceId: e.id, sourceType: "authorized_private", contentType: "authorized_expression", url: null, publishedAt: e.created_at, verified: true },
          permission: { discoverable: true, identityDisclosable: disclose, contactable: row.contact_allowed === true, status: "active" } });
        if (parsed.success) result.push(parsed.data);
      }
      if (rows.length < 500) return result;
    }
    // Do not misrepresent a truncated scan as the full effective pool.
    throw new DatabaseUnavailableError();
  }
  async listRecentlyPresentedCandidateIds(viewerId:string,signal:AbortSignal):Promise<string[]>{
    z.string().uuid().parse(viewerId);
    const rows=z.array(z.object({candidate_ref:z.string().min(1).max(80)})).parse(await this.get("discovery_candidates",{
      viewer_id:`eq.${viewerId}`,
      created_at:`gte.${new Date(Date.now()-7*86_400_000).toISOString()}`,
      select:"candidate_ref",
      order:"created_at.desc",
      limit:"40"
    },signal));
    return [...new Set(rows.map(row=>row.candidate_ref))];
  }
  async oauthAccount(userId: string, signal: AbortSignal) {
    z.string().uuid().parse(userId);
    const rows = z.array(z.object({ user_id: z.string().uuid(), access_token: z.string(),
      token_storage_version: z.literal("encrypted_v1"), expires_at: z.string().datetime({offset:true}).nullable() })).parse(
      await this.get("zhihu_accounts", { user_id: `eq.${userId}`, select: "user_id,access_token,token_storage_version,expires_at", limit: "1" }, signal));
    const row = rows[0];
    if (!row || row.user_id !== userId || !row.expires_at || Date.parse(row.expires_at) <= Date.now()) return null;
    return row;
  }
}
