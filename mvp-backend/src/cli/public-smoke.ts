import "dotenv/config";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config.js";
import { OpenAiCompatibleProvider } from "../llm/openai-compatible-provider.js";
import { runDiscoveryPipeline } from "../pipeline/discovery-pipeline.js";
import { loadSeedCandidates, RoutedCandidateSource } from "../sources/routed-source.js";
import { ZhihuCliPublicSearchProvider, ZhihuPublicSearchProvider } from "../sources/zhihu-public-search.js";

// Explicit diagnostic only. Does not change production probability, persist a
// user/card, or send any private message. At most one public search this run.
if(!process.argv.includes("--live"))throw new Error("Pass --live to permit a small paid LLM/public-search test");
const config=loadConfig();
if(config.llm.mode!=="live")throw new Error("LLM_MODE=live is required");
const allowDemoTime=process.env.ZHIHU_PUBLIC_DEMO_TIME_ENABLED==="true";
const provider=config.profile.accessSecret
  ?new ZhihuPublicSearchProvider(config.profile.accessSecret,fetch,Date.now,allowDemoTime)
  :new ZhihuCliPublicSearchProvider(process.env.ZHIHU_CLI_PATH??join(homedir(),"Library","Application Support","zhihu-cli","current","zhihu-cli"),Date.now,allowDemoTime);
const seeds=await loadSeedCandidates(Date.now,allowDemoTime);
const source=new RoutedCandidateSource("public-smoke",{list:async()=>[]},seeds.publicCandidates,[],{
  publicProbability:1,publicProvider:provider,allowPublicDemoTime:allowDemoTime
});
const result=await runDiscoveryPipeline({fixtureSet:"public-smoke",conversation:{messages:[
  {id:"u1",role:"user",content:"这半年我和几个老朋友的联系几乎都靠我主动，每次我发消息他们也会回，但从不主动来找我。我试过一个月不联系，结果真的谁也没找我。我舍不得这些关系，又不知道这种只有我主动的友情是不是还值得继续。"},
  {id:"a1",role:"assistant",content:"你在意的不只是有没有收到回复，而是这段关系是不是也被对方放在心上。",generationStatus:"complete"}
]}},{llm:new OpenAiCompatibleProvider({...config.llm,timeoutMs:60000,maxRetries:0}),candidateSource:source,
  timeoutMs:90000,dataMode:"routed",publicRecentDays:14,allowPublicDemoTime:allowDemoTime,trustedContext:{allowDiscovery:true,safetyPassed:true}});
console.log(JSON.stringify({status:result.status,reason:result.reasonCode,route:source.decision,
  publicOrigin:source.publicOrigin,searchRequests:source.zhihuSearchRequests,searchReason:source.publicSearchReason,
  matches:Object.values(result.matches).filter(Boolean).map(m=>({id:m!.candidateId,sourceType:m!.sourceType,url:m!.sourceUrl,timeKind:m!.timestampKind})),
  presentation:result.presentationCopy},null,2));
if(result.status!=="matched"||source.decision!=="public")process.exitCode=2;
