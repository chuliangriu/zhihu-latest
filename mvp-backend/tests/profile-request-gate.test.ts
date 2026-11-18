import {describe,expect,it,vi} from "vitest";
import {InMemoryProfileRequestGate,RedisProfileRequestGate} from "../src/profile/request-gate.js";
import type {RedisClientType} from "redis";
describe("credential-wide upstream request gate",()=>{
  it("spaces independent callers and bounds the queue",async()=>{
    const gate=new InMemoryProfileRequestGate();
    expect(await gate.reserve("a",1000,2000)).toEqual({waitMs:0});
    expect(await gate.reserve("a",1000,2000)).toEqual({waitMs:2000});
    expect(await gate.reserve("a",1000,2000)).toEqual({waitMs:4000});
    expect(await gate.reserve("a",1000,2000)).toEqual({waitMs:0,blocked:{code:"ZHIHU_RATE_LIMITED",until:7000}});
    expect(await gate.reserve("b",1000,2000)).toEqual({waitMs:0});
  });
  it("shares cooldown, never shortens it and keeps quota errors distinct",async()=>{
    const gate=new InMemoryProfileRequestGate();
    await gate.block("a",100000,"ZHIHU_QUOTA_EXCEEDED",1000);await gate.block("a",2000,"ZHIHU_RATE_LIMITED",1000);
    expect(await gate.reserve("a",1000,2000)).toEqual({waitMs:0,blocked:{code:"ZHIHU_QUOTA_EXCEEDED",until:100000}});
    expect(await gate.check("a",99999)).toEqual({waitMs:0,blocked:{code:"ZHIHU_QUOTA_EXCEEDED",until:100000}});
    expect(await gate.reserve("a",100000,2000)).toEqual({waitMs:0});
  });
  it("fails closed for invalid Redis state",async()=>{
    const client={eval:vi.fn().mockResolvedValue([0,9999,"invented-code"])};
    await expect(new RedisProfileRequestGate(client as unknown as Pick<RedisClientType,"eval">,"test").reserve("hash",1,2000)).rejects.toThrow("PROFILE_THROTTLE_UNAVAILABLE");
  });
});
