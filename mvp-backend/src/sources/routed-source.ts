import { readFile } from "node:fs/promises";
import { candidateExpressionSchema, type CandidateExpression } from "../contracts/schemas.js";
import { filterDisplayableCandidates, isZhihuUrl } from "../guards/candidates.js";
import { filterInjectionCandidates } from "../security/prompt-injection.js";
import { CandidateSourceError, type CandidateSource, type CandidateSearchInput, type CandidateBatch } from "./candidate-source.js";
import type { PublicSearchProvider } from "./zhihu-public-search.js";
import { demoPublicDate, ZhihuPublicSearchError } from "./zhihu-public-search.js";
import { syntheticCardProfile } from "./candidate-profile.js";

export interface PrivatePool {
  list(viewerId: string, signal: AbortSignal): Promise<CandidateExpression[]>;
  listRecentlyPresentedCandidateIds?(viewerId: string, signal: AbortSignal): Promise<string[]>;
}

/** Per-request, lazy ordered sources. Synthetic cards belong only to the separate demo. */
export class RoutedCandidateSource implements CandidateSource {
  decision: "real_private" | "public" | "empty" | null = null;
  publicWindowDays: 7 | 14 | null = null;
  publicOrigin: "live" | "backup" | null = null;
  private searchFailure: string | null = null;
  get zhihuSearchRequests(){return this.options.publicProvider?.requestCount??0;}
  get publicSearchReason(){return this.searchFailure??this.options.publicProvider?.lastReason??null;}
  private real: CandidateExpression[] | undefined;
  constructor(private readonly viewerId: string, private readonly pool: PrivatePool,
    private readonly publicCandidates: CandidateExpression[], _synthetic: CandidateExpression[],
    private readonly options: { publicProbability?: number; random?: () => number; now?: () => number; publicProvider?:PublicSearchProvider; allowPublicDemoTime?:boolean } = {}) {
    // Legacy probability/random arguments are ignored; routing is deterministic.
  }
  private clean(items: CandidateExpression[], publicDays = 7) {
    return filterInjectionCandidates(filterDisplayableCandidates(items.filter(c => c.authorId !== this.viewerId),
      this.options.now?.() ?? Date.now(), 7, Math.min(publicDays, 14), true, this.options.allowPublicDemoTime)).accepted;
  }
  private async realPool(signal: AbortSignal) {
    if (signal.aborted) throw new Error("Search aborted");
    if (!this.real) this.real = this.clean((await this.pool.list(this.viewerId, signal))
      .filter(c => c.source.sourceType === "authorized_private"));
    return this.real;
  }
  async getEligiblePrivatePoolSize(signal: AbortSignal) { return (await this.realPool(signal)).length; }
  async revalidate(ids: string[], signal: AbortSignal): Promise<boolean> {
    const selectedRealIds = ids.filter(id => this.real?.some(c => c.candidateId === id));
    if (!selectedRealIds.length) return true;
    const fresh = this.clean(await this.pool.list(this.viewerId, signal));
    return selectedRealIds.every(id => {
      const before = this.real?.find(c => c.candidateId === id);
      const after = fresh.find(c => c.candidateId === id && c.source.sourceType === "authorized_private");
      return before && after && before.text === after.text && JSON.stringify(before.permission) === JSON.stringify(after.permission);
    });
  }
  async search(input: CandidateSearchInput, signal: AbortSignal) {
    for await (const batch of this.searchBatches(input,signal)) if (batch.candidates.length) return batch.candidates;
    return [];
  }
  async *searchBatches(input: CandidateSearchInput, signal: AbortSignal): AsyncIterable<CandidateBatch> {
    this.publicWindowDays = null;
    this.publicOrigin = null;
    this.searchFailure = null;
    const recentlyPresented = new Set(await this.pool.listRecentlyPresentedCandidateIds?.(this.viewerId,signal)??[]);
    const rank = (items: CandidateExpression[]) => {
      const scored=items.map(candidate => ({ candidate, score: relevance(input.directions, candidate.text) }))
        .filter(x => x.score > 0).sort((a,b) => b.score - a.score);
      const unseen=scored.filter(x=>!recentlyPresented.has(x.candidate.candidateId));
      return (unseen.length?unseen:scored).map(x=>x.candidate).slice(0,input.limit);
    };
    this.decision = "real_private";
    yield {source:"authorized_private",candidates:rank(await this.realPool(signal))};
    signal.throwIfAborted();
    const publicRecall = (items: CandidateExpression[]) => {
      const publicItems=items.filter(c=>c.source.sourceType==="public"&&isZhihuUrl(c.source.url));
      for (const days of [7,14] as const) {
        const candidates=rank(this.clean(publicItems,days));
        if(candidates.length){this.publicWindowDays=days;return candidates;}
      }
      return [];
    };
    this.decision="public";this.publicOrigin="backup";
    yield {source:"public_inventory",candidates:publicRecall(this.publicCandidates)};
    signal.throwIfAborted();
    this.publicOrigin="live";this.publicWindowDays=null;
    if(this.options.publicProvider){
      let dynamic:CandidateExpression[];
      try { dynamic=await this.options.publicProvider.search(input.directions,signal); }
      catch(error){
        this.searchFailure=error instanceof ZhihuPublicSearchError?error.code:"ZHIHU_SEARCH_UNAVAILABLE";
        throw new CandidateSourceError(this.searchFailure,"public_search");
      }
      yield {source:"public_search",candidates:publicRecall(dynamic),reasonCode:this.options.publicProvider.lastReason??"completed"};
    } else {
      // Disabled search is an unavailable source, not a successfully empty result.
      this.searchFailure="ZHIHU_SEARCH_NOT_CONNECTED";
      throw new CandidateSourceError(this.searchFailure,"public_search");
    }
    this.decision="empty";
  }

}

const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
const stopwords = new Set(["一个", "一些", "什么", "怎么", "如何", "自己", "别人", "没有", "可以", "觉得", "的人", "相关", "经历", "问题", "事情", "因为", "但是", "这种", "还是"]);
export function relevance(directions: string[], text: string): number {
  const words = new Set(directions.flatMap(d => [...segmenter.segment(d)].filter(s => s.isWordLike)
    .map(s => s.segment.toLowerCase())).filter(w => w.length >= 2 && !stopwords.has(w)));
  const lower = text.toLowerCase();
  return [...words].reduce((score, word) => score + (lower.includes(word) ? 1 : 0), 0);
}

export async function loadSeedCandidates(now: () => number = Date.now, allowPublicDemoTime=false) {
  const corpus = JSON.parse(await readFile(new URL("../../data/zhihu-public-corpus.json", import.meta.url), "utf8"));
  const virtual = JSON.parse(await readFile(new URL("../../data/synthetic-cards.json", import.meta.url), "utf8"));
  const publicCandidates: CandidateExpression[] = [];
  let demoTimes:{items?:Array<{sourceId:string;displayDaysAgo:number}>}={};
  if(allowPublicDemoTime){try{demoTimes=JSON.parse(await readFile(new URL("../../data/public-demo-times.json",import.meta.url),"utf8"));}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}}
  for (const r of corpus.records) {
    if (!r || r.usage !== "public_candidate" || typeof r.id!=="string" || typeof r.text!=="string" || !isZhihuUrl(r.url)) continue;
    const explicit=r.publicationTimeVerified===true&&typeof r.publishedAt==="string"?Date.parse(r.publishedAt):NaN;
    const hasPublished=Number.isFinite(explicit);
    const demo=!hasPublished&&allowPublicDemoTime;
    if(!hasPublished&&!demo&&!Number.isFinite(r.editTime))continue;
    const candidate = candidateExpressionSchema.safeParse({ candidateId: r.id, authorId: `zhihu:${r.authorKey}`.slice(0,80),
      authorDisplayName: r.authorName || "知乎用户", domain: r.domain, text: r.text.slice(0,4000),
      source: { sourceId: r.id, sourceType: "public", contentType: r.contentType, url: r.url,
        publishedAt: hasPublished?new Date(explicit).toISOString():demo?demoPublicDate(r.id,now(),demoTimes.items?.find(x=>x.sourceId===r.id)?.displayDaysAgo):new Date(r.editTime * 1000).toISOString(), timestampKind: hasPublished?"published":demo?"sample_created":"edited_or_published", verified: true,
        interactionFacts: { upvotes: r.voteUpCount??null, comments: r.commentCount??null } },
      permission: { discoverable: true, identityDisclosable: true, contactable: false, status: "active" } });
    if (candidate.success) publicCandidates.push(candidate.data);
  }
  const syntheticNow = now();
  const synthetic = virtual.cards.map(({ adaptation: _reference, ...card }: { adaptation: unknown; [key: string]: unknown }, index: number) => {
    const text = typeof card.text === "string" ? card.text : "";
    const profile = syntheticCardProfile(text);
    const parsed = candidateExpressionSchema.parse({
      ...card,
      profileBackground: card.profileBackground ?? profile.profileBackground,
      recentFocus: card.recentFocus ?? profile.recentFocus
    });
    // Cold-start time is intentionally authored sample data, kept within the
    // approved seven-day window. It is not a verified publication timestamp.
    // The source file may retain the production-private shape used while the
    // cards were authored. Normalize every cold-start card at this trust
    // boundary so it enters only the clearly labelled synthetic pool.
    parsed.source.sourceType = "synthetic_private";
    parsed.source.contentType = "authorized_expression";
    parsed.source.url = null;
    parsed.source.publishedAt = new Date(syntheticNow - (index % 6 + 1) * 86_400_000).toISOString();
    parsed.source.timestampKind = "sample_created";
    parsed.source.verified = false;
    parsed.permission.contactable = false;
    return parsed;
  });
  return { publicCandidates, synthetic: synthetic as CandidateExpression[] };
}
