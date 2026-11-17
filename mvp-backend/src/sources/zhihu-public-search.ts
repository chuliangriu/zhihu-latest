import { candidateExpressionSchema,type CandidateExpression } from "../contracts/schemas.js";
import { isZhihuUrl } from "../guards/candidates.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export interface PublicSearchProvider { search(directions:string[],signal:AbortSignal):Promise<CandidateExpression[]>; readonly requestCount:number; readonly lastReason:string|null; }
export class ZhihuPublicSearchError extends Error { constructor(public readonly code:string){super(code);} }

/**
 * Searches the official Zhihu endpoint, but accepts a result only if the
 * response carries an explicit publication timestamp, or the server opts into
 * clearly labelled demo dates. EditTime never becomes a verified publication.
 */
export class ZhihuPublicSearchProvider implements PublicSearchProvider{
  requestCount=0;lastReason:string|null=null;
  constructor(private readonly accessSecret:string,private readonly fetcher:typeof fetch=fetch,private readonly now:()=>number=Date.now,private readonly allowDemoTime=false){}
  async search(directions:string[],signal:AbortSignal){
    const query=publicSearchQuery(directions);
    if(!query){this.lastReason="empty_query";return[];}
    const url=new URL("https://developer.zhihu.com/api/v1/content/zhihu_search");url.searchParams.set("Query",query);url.searchParams.set("Count","10");
    this.requestCount++;
    let response:Response;try{response=await this.fetcher(url,{headers:{Authorization:`Bearer ${this.accessSecret}`,"X-Request-Timestamp":String(Math.floor(this.now()/1000)),"Content-Type":"application/json"},signal:AbortSignal.any([signal,AbortSignal.timeout(8000)]),redirect:"error"});}
    catch{throw new ZhihuPublicSearchError("ZHIHU_SEARCH_UNAVAILABLE");}
    if(!response.ok)throw new ZhihuPublicSearchError(response.status===429?"ZHIHU_RATE_LIMITED":[401,403].includes(response.status)?"ZHIHU_AUTH_FAILED":"ZHIHU_SEARCH_UNAVAILABLE");
    const payload=await limitedJson(response);const code=Number(payload?.Code);
    if(code!==0)throw new ZhihuPublicSearchError(code===30001||code===30002?"ZHIHU_RATE_LIMITED":code===20001?"ZHIHU_AUTH_FAILED":"ZHIHU_SEARCH_UNAVAILABLE");
    if(!Array.isArray(payload?.Data?.Items))throw new ZhihuPublicSearchError("ZHIHU_RESPONSE_INVALID");
    const parsed=parsePublicSearchItems(payload.Data.Items,this.now(),this.allowDemoTime);
    this.lastReason=parsed.reason;return parsed.candidates;
  }
}

// Local loopback development only. The official CLI reads its own keychain;
// no credential is exported, logged, or passed as a command-line argument.
const exec=promisify(execFile);
export class ZhihuCliPublicSearchProvider implements PublicSearchProvider {
  requestCount=0;lastReason:string|null=null;
  constructor(private readonly cliPath:string,private readonly now:()=>number=Date.now,private readonly allowDemoTime=false){}
  async search(directions:string[],signal:AbortSignal){
    const query=publicSearchQuery(directions);
    if(!query){this.lastReason="empty_query";return [];}
    this.requestCount++;
    let output:string;
    try {
      const result=await exec(this.cliPath,["search","zhihu","--query",query,"--count","10","--timeout","8s"],{timeout:10000,maxBuffer:524288,signal});
      output=result.stdout;
    } catch(error) {
      // CLI errors can contain command/query text. Only surface an allowlisted code.
      const stdout=(error as {stdout?:unknown}).stdout;
      if(typeof stdout==="string") { try { const code=Number(JSON.parse(stdout)?.Code); if([30001,30002].includes(code))throw new ZhihuPublicSearchError("ZHIHU_RATE_LIMITED"); if(code===20001)throw new ZhihuPublicSearchError("ZHIHU_AUTH_FAILED"); } catch(e){if(e instanceof ZhihuPublicSearchError)throw e;} }
      throw new ZhihuPublicSearchError("ZHIHU_SEARCH_UNAVAILABLE");
    }
    let payload;try{payload=JSON.parse(output);}catch{throw new ZhihuPublicSearchError("ZHIHU_RESPONSE_INVALID");}
    const code=Number(payload?.Code);
    if(code!==0)throw new ZhihuPublicSearchError([30001,30002].includes(code)?"ZHIHU_RATE_LIMITED":code===20001?"ZHIHU_AUTH_FAILED":"ZHIHU_SEARCH_UNAVAILABLE");
    if(!Array.isArray(payload?.Data?.Items))throw new ZhihuPublicSearchError("ZHIHU_RESPONSE_INVALID");
    const parsed=parsePublicSearchItems(payload.Data.Items,this.now(),this.allowDemoTime);
    this.lastReason=parsed.reason;return parsed.candidates;
  }
}

/** Display-only demo date, never written back over a source's original time. */
export function demoPublicDate(id:string,now:number,days?:number) {
  const age=typeof days==="number"&&Number.isInteger(days)&&days>=1&&days<=14?days:1+[...id].reduce((n,c)=>n+c.charCodeAt(0),0)%7;
  return new Date(now-age*86400000).toISOString();
}
// One focused query, not the conjunction of two potentially different topics.
export function publicSearchQuery(directions:string[]){return directions.map(x=>x.trim()).find(Boolean)?.slice(0,80)??"";}
export function parsePublicSearchItems(items:unknown[],now:number,allowDemoTime=false){
    const result:CandidateExpression[]=[];let ambiguous=0;
    for(const value of items.slice(0,10)){
      const item=value as Record<string,unknown>;
      if(!item||typeof item!=="object")continue;
      // Future-compatible only: current documented search payload has EditTime,
      // which may be an edit and therefore cannot satisfy the 14-day rule.
      const rawPublished=item.PublishedAt??item.CreatedAt;
      const published=rawPublished==null||rawPublished===""?NaN:Number(rawPublished);
      const demo=!Number.isFinite(published);
      if(demo){ambiguous++;if(!allowDemoTime)continue;}
      const publishedMs=published*1000;if(!demo&&(publishedMs>now||publishedMs<now-14*86_400_000))continue;
      const rawUrl=typeof item?.Url==="string"?item.Url:"";if(!isZhihuUrl(rawUrl))continue;
      const text=plain(item?.ContentText,4000);if(text.length<8)continue;
      const contentType=mapType(item?.ContentType);if(!contentType)continue;
      const contentId=plain(item?.ContentID,64);if(!contentId)continue;
      const parsed=candidateExpressionSchema.safeParse({candidateId:`zhihu-${contentId}`.slice(0,80),authorId:`public-content-${contentId}`.slice(0,80),authorDisplayName:plain(item?.AuthorName,80)||"知乎用户",authorProfileUrl:null,domain:"zhihu_public",text,
        source:{sourceId:`zhihu-${contentId}`.slice(0,100),sourceType:"public",contentType,url:rawUrl,publishedAt:demo?demoPublicDate(contentId,now):new Date(publishedMs).toISOString(),timestampKind:demo?"sample_created":"published",verified:true,interactionFacts:{upvotes:nonnegative(item?.VoteUpCount),comments:nonnegative(item?.CommentCount)}},permission:{discoverable:true,identityDisclosable:true,contactable:false,status:"active"}});
      if(parsed.success)result.push(parsed.data);
    }
    return {candidates:result,reason:result.some(c=>c.source.timestampKind==="sample_created")?"explicit_demo_time":result.length?"verified_publication_time":ambiguous?"only_ambiguous_edit_time":"no_recent_result"};
}
function mapType(value:unknown){const v=typeof value==="string"?value.toLowerCase():"";return v.includes("answer")?"answer" as const:v.includes("article")?"article" as const:v.includes("question")?"question" as const:null;}
function plain(value:unknown,limit:number){return typeof value==="string"?value.replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,limit):"";}
function nonnegative(value:unknown){if(value==null||value==="")return null;const n=Number(value);return Number.isInteger(n)&&n>=0?n:null;}
async function limitedJson(response:Response){const text=await response.text();if(Buffer.byteLength(text,"utf8")>524288)throw new ZhihuPublicSearchError("ZHIHU_RESPONSE_INVALID");try{return JSON.parse(text);}catch{throw new ZhihuPublicSearchError("ZHIHU_RESPONSE_INVALID");}}
