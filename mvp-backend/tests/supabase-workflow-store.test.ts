import { describe, expect, it, vi } from "vitest";
import { SupabaseWorkflowStore } from "../src/workflow/supabase-store.js";

const ownerId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const paperId = "33333333-3333-4333-8333-333333333333";
const discoveryId = "44444444-4444-4444-8444-444444444444";
const deliveryId = "55555555-5555-4555-8555-555555555555";
const offsetTime = new Date().toISOString();
const futureTime = new Date(Date.now() + 7 * 86_400_000).toISOString();

describe("Supabase workflow store", () => {
  it("accepts a successful PostgREST return=minimal response with no JSON body", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    const store = new SupabaseWorkflowStore("https://example.supabase.co", "sb_secret_test", fetcher as typeof fetch);

    await expect(store.saveTopicAssessment(conversationId, ownerId, paperId, {
      personalSituation: true,
      topicKey: "writing-without-readers",
      evidenceMessageIds: [conversationId],
      transition: "first",
      reason: "clear personal dilemma"
    })).resolves.toBeUndefined();
  });

  it("accepts PostgREST offset timestamps", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([{
      id: conversationId,
      owner_id: ownerId,
      created_at: offsetTime,
      updated_at: offsetTime
    }]), { status: 201, headers: { "Content-Type": "application/json" } }));
    const store = new SupabaseWorkflowStore("https://example.supabase.co", "sb_secret_test", fetcher as typeof fetch);

    await expect(store.createConversation(ownerId)).resolves.toMatchObject({
      id: conversationId,
      ownerId,
      createdAt: offsetTime
    });
  });

  it("parses the scalar JSON returned by the transactional confirmation RPC", async () => {
    const paper = {
      id: paperId, owner_id: ownerId, conversation_id: conversationId,
      current_version: 2, status: "active", subject: "等待回声",
      quote: "我仍在等一个能够判断下一步的回声。", context: "持续投入",
      background: "这个人持续做着一件重要的事，却一直没有等到回应。",
      discoverable_until: futureTime, identity_disclosure: "nickname",
      contact_allowed: true, confirmed_at: offsetTime, withdrawn_at: null,
      created_at: offsetTime, updated_at: offsetTime
    };
    const delivery = {
      id: deliveryId, paper_id: paperId, paper_version: 2, sender_id: ownerId,
      discovery_id: discoveryId, candidate_ref: "candidate-1", status: "delivered",
      created_at: offsetTime
    };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ paper, delivery }), {
      status: 200, headers: { "Content-Type": "application/json" }
    }));
    const store = new SupabaseWorkflowStore("https://example.supabase.co", "sb_secret_test", fetcher as typeof fetch);

    await expect(store.confirmPaperAndDeliver({
      id: paperId, ownerId, expectedVersion: 1,
      discoverableUntil: futureTime,
      identityDisclosure: "nickname", contactAllowed: true,
      discoveryId, candidateId: "candidate-1"
    })).resolves.toMatchObject({
      paper: { id: paperId, version: 2, status: "active" },
      delivery: { id: deliveryId, candidateId: "candidate-1" }
    });
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://example.supabase.co/rest/v1/rpc/confirm_and_deliver_mailbox_paper_v2");
  });

  it("maps database serialization conflicts to a stable store conflict", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "40001" }), {
      status: 400, headers: { "Content-Type": "application/json" }
    }));
    const store = new SupabaseWorkflowStore("https://example.supabase.co", "sb_secret_test", fetcher as typeof fetch);

    await expect(store.withdrawPaper(paperId, ownerId)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("stores a non-UUID private fixture as synthetic instead of a real recipient",async()=>{
    let candidateInsert:any;
    const run={id:discoveryId,owner_id:ownerId,conversation_id:conversationId,pipeline_request_id:paperId,created_at:offsetTime,expires_at:futureTime};
    const fetcher=vi.fn(async(url:URL|string|Request,init?:RequestInit)=>{
      const value=new URL(String(url));const method=init?.method??"GET";
      if(value.pathname.endsWith("/discovery_runs")&&method==="POST")return new Response(JSON.stringify([run]),{status:201,headers:{"Content-Type":"application/json"}});
      if(value.pathname.endsWith("/discovery_candidates")&&method==="POST"){
        candidateInsert=JSON.parse(String(init?.body));return new Response(null,{status:201});
      }
      if(value.pathname.endsWith("/discovery_runs"))return new Response(JSON.stringify([run]),{status:200,headers:{"Content-Type":"application/json"}});
      if(value.pathname.endsWith("/discovery_candidates"))return new Response(JSON.stringify([{candidate_ref:"fixture-private",path:"situationClose",source_type:"synthetic_private",source_url:null,author_profile_url:null,contactable:false,published_at:offsetTime,excerpt_snapshot:"一直没有人听见",relation_snapshot:"都在等待作品的回声"}]),{status:200,headers:{"Content-Type":"application/json"}});
      throw new Error(`Unexpected request ${method} ${value.pathname}`);
    });
    const store=new SupabaseWorkflowStore("https://example.supabase.co","sb_secret_test",fetcher as typeof fetch);
    await store.saveDiscovery(ownerId,conversationId,{requestId:paperId,status:"matched",matches:{situationClose:{path:"situationClose",candidateId:"fixture-private",sourceType:"authorized_private",sourceUrl:null,authorProfileUrl:null,contactable:true,publishedAt:offsetTime,evidenceRefs:[{side:"candidate",refId:"fixture",quote:"一直没有人听见"}],sharedRelation:"都在等待作品的回声"},structureRelated:null}} as any);

    expect(candidateInsert[0]).toMatchObject({candidate_ref:"fixture-private",source_type:"synthetic_private",source_expression_id:null,contactable:false});
  });
});
