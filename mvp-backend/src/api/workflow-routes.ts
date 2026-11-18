import { randomUUID } from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { chatRequestSchema } from "../chat/contracts.js";
import { BusinessStoreError } from "../chat/store.js";
import type { ChatService } from "../chat/service.js";
import { ChatServiceError } from "../chat/service.js";
import type { DiscoveryRuntime } from "../runtime.js";
import { requireInternalIdentity, hashIdentifier } from "../security/identity.js";
import { requireSessionIdentity, type SessionResolver } from "../security/session-identity.js";
import type { ProtectionService } from "../security/protection-service.js";
import type { EndpointId } from "../security/types.js";
import { handoffRequestSchema, paperConfirmRequestSchema, paperDraftRequestSchema, paperEditRequestSchema } from "../workflow/contracts.js";
import type { WorkflowService } from "../workflow/service.js";
import { WorkflowServiceError, usageTrace } from "../workflow/service.js";
import { LlmProviderError } from "../llm/provider.js";
import type { WorkflowStore } from "../workflow/store.js";

const discoveryRequestSchema = z.object({ assistantMessageId:z.string().uuid(),topicKey:z.string().trim().min(1).max(120) }).strict();
const idempotencyKeyPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{15,127}$/;

export function registerWorkflowRoutes(app:Express,deps:{config:AppConfig;runtime:Pick<DiscoveryRuntime,"evaluateDetailed">;
  sessionResolver?:SessionResolver;chatService:ChatService;workflowService:WorkflowService;workflowStore:WorkflowStore},protection:ProtectionService){
  const auth = deps.config.authMode === "session" ? requireSessionIdentity(deps.sessionResolver,deps.config.corsOrigins) : requireInternalIdentity(deps.config);

  app.post("/api/chat/reply",auth,async(request,response,next)=>{
    const parsed=chatRequestSchema.safeParse(request.body); if(!parsed.success){response.status(400).json({error:{code:"INVALID_REQUEST"}});return;}
    const started=await begin(request,response,protection,deps.config,"chat.reply",2,true); if(!started)return;
    const controller=new AbortController();
    request.once("aborted",()=>controller.abort());
    response.once("close",()=>{if(!response.writableEnded)controller.abort();});
    let headersSent=false;
    try{
      const completed=await deps.chatService.reply({ownerId:request.principal!.userId,...parsed.data,signal:controller.signal,onChunk:chunk=>{
        if(!headersSent){response.status(200);response.setHeader("Content-Type","text/event-stream; charset=utf-8");response.setHeader("Connection","keep-alive");response.flushHeaders();headersSent=true;}
        response.write(sse("delta",{text:chunk}));
      },onAnswerComplete:value=>{response.write(sse("answer_done",value));}});
      const trace={requestId:started.context.requestId,matchPolicy:null,stages:completed.trace.usage.map((usage,index)=>({name:index===0?"normal_reply":"topic_assessment",durationMs:0,usage})),rejectedMatches:[]};
      await protection.finishDiscovery(started.context,{statusCode:200,businessStatus:"ready",reasonCode:completed.trace.reasonCode,trace,conservative:false});
      response.locals.monitoringRecorded=true;
      if(!headersSent){response.setHeader("Content-Type","text/event-stream; charset=utf-8");headersSent=true;}
      response.end(sse("done",completed.result));
    }catch(error){
      await protection.finishDiscovery(started.context,{statusCode:controller.signal.aborted?499:503,businessStatus:"unavailable",reasonCode:errorCode(error),conservative:true}).catch(()=>undefined);
      response.locals.monitoringRecorded=true;
      if(headersSent){response.end(sse("error",{code:publicErrorCode(error)}));return;}
      next(error);
    }
  });

  app.post("/api/conversations/:conversationId/discovery",auth,async(request,response,next)=>{
    const route=z.string().uuid().safeParse(request.params.conversationId),body=discoveryRequestSchema.safeParse(request.body);
    if(!route.success||!body.success){response.status(400).json({error:{code:"INVALID_REQUEST"}});return;}
    const started=await begin(request,response,protection,deps.config,"discovery.evaluate",deps.config.candidateMode === "routed" ? 5 : 3,true);if(!started)return;
    try{
      const ownerId=request.principal!.userId;
      const assessment=await deps.workflowStore.getTopicAssessment(route.data,ownerId,body.data.assistantMessageId);
      if(!assessment||assessment.topicKey!==body.data.topicKey){throw new WorkflowServiceError("TOPIC_DISPLAY_NOT_ELIGIBLE");}
      const messages=(await deps.workflowStore.listMessages(route.data,ownerId,24)).filter(x=>x.generationStatus==="complete")
        .map(({id,role,content,generationStatus})=>({id,role,content,generationStatus}));
      const detailed=await deps.runtime.evaluateDetailed({fixtureSet:"feedback-across-domains",conversation:{messages}},request.principal);
      let discovery=null;
      if(detailed.result.status==="matched"){
        await deps.chatService.confirmDisplay({ownerId,conversationId:route.data,...body.data});
        discovery=await deps.workflowService.saveDiscovery(ownerId,route.data,detailed.result);
      }
      await protection.finishDiscovery(started.context,{statusCode:200,businessStatus:detailed.result.status,reasonCode:detailed.result.reasonCode,trace:detailed.trace,conservative:detailed.result.status==="unavailable"});
      response.locals.monitoringRecorded=true;response.json({success:true,data:{...detailed.result,discoveryId:discovery?.id??null}});
    }catch(error){await fail(protection,started.context,response,error);next(error);}
  });

  app.post("/api/papers/drafts",auth,async(request,response,next)=>{
    const parsed=paperDraftRequestSchema.safeParse(request.body);if(!parsed.success){response.status(400).json({error:{code:"INVALID_REQUEST"}});return;}
    const started=await begin(request,response,protection,deps.config,"paper.draft",1,true);if(!started)return;
    try{const output=await deps.workflowService.draftPaper(request.principal!.userId,parsed.data.conversationId,parsed.data.confirmedProfile,AbortSignal.timeout(deps.config.pipelineTimeoutMs));
      await protection.finishDiscovery(started.context,{statusCode:200,businessStatus:"draft",reasonCode:"paper_draft_created",trace:usageTrace("own_paper_draft",output.usage),conservative:false});
      response.locals.monitoringRecorded=true;response.status(201).json({success:true,data:output.paper});
    }catch(error){await fail(protection,started.context,response,error);next(error);}
  });

  app.patch("/api/papers/:paperId",auth,async(request,response,next)=>{
    const id=z.string().uuid().safeParse(request.params.paperId),parsed=paperEditRequestSchema.safeParse(request.body);
    if(!id.success||!parsed.success){response.status(400).json({error:{code:"INVALID_REQUEST"}});return;}
    const started=await begin(request,response,protection,deps.config,"paper.edit",0,false);if(!started)return;
    try{const {expectedVersion,...fields}=parsed.data;const paper=await deps.workflowService.editPaper(request.principal!.userId,id.data,expectedVersion,fields);
      await finishLow(protection,started.context,response,"paper_edited");response.json({success:true,data:paper});
    }catch(error){await fail(protection,started.context,response,error);next(error);}
  });

  app.post("/api/papers/:paperId/confirm",auth,async(request,response,next)=>{
    const id=z.string().uuid().safeParse(request.params.paperId),parsed=paperConfirmRequestSchema.safeParse(request.body);
    if(!id.success||!parsed.success){response.status(400).json({error:{code:"INVALID_REQUEST"}});return;}
    const started=await begin(request,response,protection,deps.config,"paper.confirm",0,false);if(!started)return;
    try{const result=await deps.workflowService.confirmPaper({ownerId:request.principal!.userId,id:id.data,...parsed.data});
      await finishLow(protection,started.context,response,result.delivery?"paper_confirmed_and_delivered":"paper_confirmed");response.json({success:true,data:result});
    }catch(error){await fail(protection,started.context,response,error);next(error);}
  });

  app.post("/api/papers/:paperId/withdraw",auth,async(request,response,next)=>{
    const id=z.string().uuid().safeParse(request.params.paperId);if(!id.success){response.status(400).json({error:{code:"INVALID_REQUEST"}});return;}
    const started=await begin(request,response,protection,deps.config,"paper.withdraw",0,false);if(!started)return;
    try{const paper=await deps.workflowService.withdrawPaper(request.principal!.userId,id.data);await finishLow(protection,started.context,response,"paper_withdrawn");response.json({success:true,data:paper});}
    catch(error){await fail(protection,started.context,response,error);next(error);}
  });

  app.post("/api/handoffs",auth,async(request,response,next)=>{
    const parsed=handoffRequestSchema.safeParse(request.body);if(!parsed.success){response.status(400).json({error:{code:"INVALID_REQUEST"}});return;}
    const started=await begin(request,response,protection,deps.config,"handoff.create",0,false);if(!started)return;
    try{const result=await deps.workflowService.handoff(request.principal!.userId,parsed.data.discoveryId,parsed.data.candidateId);
      await finishLow(protection,started.context,response,"handoff_created");response.json({success:true,data:result});}
    catch(error){await fail(protection,started.context,response,error);next(error);}
  });
}

async function begin(request:Request,response:Response,protection:ProtectionService,config:AppConfig,endpointId:EndpointId,llmRequestBase:number,requiresLlm:boolean){
  const key=request.header("idempotency-key")??"";if(!idempotencyKeyPattern.test(key)){response.status(400).json({error:{code:"IDEMPOTENCY_KEY_REQUIRED"}});return null;}
  const principal=request.principal,secret=config.identity.ipHashSecret,ipHash=request.clientIpHash;
  if(!principal||!secret||!ipHash){response.status(503).json({error:{code:"IDENTITY_SERVICE_UNAVAILABLE"}});return null;}
  const decision=await protection.beginDiscovery({principal,userIdHash:hashIdentifier(principal.userId,secret),sessionIdHash:hashIdentifier(principal.sessionId,secret),ipHash,idempotencyKey:key,endpointId,llmRequestBase,requiresLlm,
    ...(endpointId==="discovery.evaluate"&&config.publicSearchEnabled?{zhihuSearchRequestReserve:1}:{})});
  if(!decision.allowed){if(decision.rateResetAt)response.setHeader("Retry-After",Math.max(1,Math.ceil((decision.rateResetAt-Date.now())/1000)));response.status(decision.statusCode).json({error:{code:decision.reasonCode}});return null;}
  response.setHeader("RateLimit-Remaining",decision.rateRemaining);return decision;
}
async function finishLow(protection:ProtectionService,context:any,response:Response,reasonCode:string){await protection.finishDiscovery(context,{statusCode:200,businessStatus:"ready",reasonCode,conservative:false});response.locals.monitoringRecorded=true;}
async function fail(protection:ProtectionService,context:any,response:Response,error:unknown){const statusCode=failureStatus(error);await protection.finishDiscovery(context,{statusCode,businessStatus:statusCode>=500?"unavailable":"rejected",reasonCode:errorCode(error),conservative:statusCode>=500}).catch(()=>undefined);response.locals.monitoringRecorded=true;}
function errorCode(error:unknown){return error&&typeof error==="object"&&"code" in error&&typeof error.code==="string"?error.code:"WORKFLOW_FAILED";}
function failureStatus(error:unknown){if(error instanceof LlmProviderError)return publicLlmFailure(error).status;if(error instanceof BusinessStoreError)return error.code==="NOT_FOUND"?404:error.code==="FORBIDDEN"?403:error.code==="CONFLICT"?409:503;if(error instanceof WorkflowServiceError||error instanceof ChatServiceError)return /INJECTION|REJECTED/.test(error.code)?400:/UNAVAILABLE/.test(error.code)?422:409;return 503;}
function publicErrorCode(error:unknown){if(error instanceof LlmProviderError)return publicLlmFailure(error).code;const code=errorCode(error);return code==="LLM_ABORTED"?"REQUEST_CANCELLED":code;}
// Expose only our stable categories, never provider messages, response bodies,
// configuration, or arbitrary upstream codes. Failed requests remain failures.
function publicLlmFailure(error:LlmProviderError){
  if(error.code==="LLM_ABORTED")return{status:503,code:"REQUEST_CANCELLED"};
  if(error.code==="LLM_TIMEOUT_OR_ABORTED")return{status:504,code:"LLM_TIMEOUT"};
  if(["LLM_OUTPUT_LIMIT_REACHED","LLM_SCHEMA_INVALID","LLM_OUTPUT_NOT_JSON","LLM_RESPONSE_NOT_JSON","LLM_EMPTY_RESPONSE","LLM_RESPONSE_TOO_LARGE","LLM_STREAM_INVALID","LLM_STREAM_ERROR"].includes(error.code))return{status:502,code:"LLM_OUTPUT_INVALID"};
  if(error.code==="LLM_HTTP_429")return{status:503,code:"LLM_UPSTREAM_BUSY"};
  return{status:503,code:"LLM_UNAVAILABLE"};
}
function sse(event:string,data:unknown){return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;}

export function workflowErrorMiddleware(error:unknown,_request:Request,response:Response,next:NextFunction){
  if(response.headersSent){next(error);return;}
  if(error instanceof LlmProviderError){const failure=publicLlmFailure(error);response.status(failure.status).json({error:{code:failure.code}});return;}
  if(error instanceof BusinessStoreError){const status=error.code==="NOT_FOUND"?404:error.code==="FORBIDDEN"?403:error.code==="CONFLICT"?409:503;response.status(status).json({error:{code:`STORE_${error.code}`}});return;}
  if(error instanceof WorkflowServiceError||error instanceof ChatServiceError){const status=/INJECTION|REJECTED/.test(error.code)?400:/UNAVAILABLE/.test(error.code)?422:409;response.status(status).json({error:{code:error.code}});return;}
  next(error);
}
