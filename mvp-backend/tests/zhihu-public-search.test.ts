import {afterEach,describe,expect,it,vi} from "vitest";
import {ZhihuPublicSearchProvider,parsePublicSearchItems,publicSearchQuery} from "../src/sources/zhihu-public-search.js";
const now=Date.parse("2026-09-15T00:00:00Z");
afterEach(()=>vi.restoreAllMocks());
describe("Zhihu public recency boundary",()=>{
  it("rejects documented EditTime because it is not a verified publication time",async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({Code:0,Data:{Items:[item({EditTime:now/1000})]}}));
    const provider=new ZhihuPublicSearchProvider("secret",fetcher,()=>now);
    expect(await provider.search(["写作 没有读者"],new AbortController().signal)).toEqual([]);
    expect(provider.lastReason).toBe("only_ambiguous_edit_time");expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("accepts a future explicit PublishedAt field only within 14 days",async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({Code:0,Data:{Items:[item({PublishedAt:(now-8*86400000)/1000})]}}));
    const provider=new ZhihuPublicSearchProvider("secret",fetcher,()=>now);const found=await provider.search(["写作"],new AbortController().signal);
    expect(found[0]).toMatchObject({source:{timestampKind:"published",verified:true},permission:{contactable:false}});
  });
  it("stops immediately on rate limiting",async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response("limited",{status:429}));
    await expect(new ZhihuPublicSearchProvider("secret",fetcher,()=>now).search(["写作"],new AbortController().signal)).rejects.toMatchObject({code:"ZHIHU_RATE_LIMITED"});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([200,429])("preserves explicit quota error with HTTP %s and does not retry",async status=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({Code:30002},{status}));
    await expect(new ZhihuPublicSearchProvider("secret",fetcher,()=>now).search(["写作"],new AbortController().signal)).rejects.toMatchObject({code:"ZHIHU_QUOTA_EXCEEDED"});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("keeps all valid live results and null metrics, marks unknown publication only in demo mode",()=>{
    const first={...item({EditTime:now/1000}),VoteUpCount:null,CommentCount:null};
    const second={...item({PublishedAt:(now-86400000)/1000}),ContentID:"124"};
    const found=parsePublicSearchItems([first,second],now,true).candidates;
    expect(found).toHaveLength(2);
    expect(found[0]?.source).toMatchObject({timestampKind:"sample_created",url:first.Url,interactionFacts:{upvotes:null,comments:null}});
    expect(found[1]?.source.timestampKind).toBe("published");
    expect(parsePublicSearchItems([first],now,false).candidates).toEqual([]);
  });
  it("demo mode never rewrites a known old publication or accepts foreign URLs",()=>{
    expect(parsePublicSearchItems([item({PublishedAt:(now-15*86400000)/1000}),{...item({}),Url:"https://evil.example/a"}],now,true).candidates).toEqual([]);
  });
  it("uses the first focused topic instead of joining unrelated search directions",()=>{
    expect(publicSearchQuery(["", "画画 没人看 继续", "工作 没有反馈"])).toBe("画画 没人看 继续");
  });
});
function item(time:Record<string,number>){return{Title:"没人看时还要不要继续写",ContentType:"Answer",ContentID:"123",ContentText:"我仍然在写，只是不知道没有读者的时候还该不该继续。",Url:"https://www.zhihu.com/answer/123",CommentCount:0,VoteUpCount:0,AuthorName:"知乎用户",...time};}
