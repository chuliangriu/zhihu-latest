import "dotenv/config";
import {loadConfig} from "../config.js";
import {OpenAiCompatibleProvider} from "../llm/openai-compatible-provider.js";
import {ChatService} from "../chat/service.js";
import {InMemoryWorkflowStore} from "../workflow/store.js";
import {WorkflowService} from "../workflow/service.js";

const config=loadConfig();if(config.llm.mode!=="live")throw new Error("workflow smoke requires LLM_MODE=live");
const store=new InMemoryWorkflowStore(),create=()=>new OpenAiCompatibleProvider(config.llm),chat=new ChatService(store,create),workflow=new WorkflowService(store,create);
let answer="";
const replied=await chat.reply({ownerId:"11111111-1111-4111-8111-111111111111",conversationId:null,
  message:"我花了很久做一件自己在意的事，但一直没有得到回应。我不是已经不想做了，只是越来越不知道还能拿什么判断下一步。",
  signal:AbortSignal.timeout(config.pipelineTimeoutMs),onChunk:chunk=>{answer+=chunk;}});
const drafted=await workflow.draftPaper("11111111-1111-4111-8111-111111111111",replied.result.conversationId,null,AbortSignal.timeout(config.pipelineTimeoutMs));
console.log(JSON.stringify({normalReply:answer,topicAssessment:replied.result.discovery,paperDraft:{subject:drafted.paper.subject,quote:drafted.paper.quote,context:drafted.paper.context,background:drafted.paper.background},usage:{chat:replied.trace.usage,paper:drafted.usage}},null,2));
