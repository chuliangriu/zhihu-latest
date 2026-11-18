import type { RedisClientType } from "redis";

export type ZhihuLimitCode = "ZHIHU_RATE_LIMITED" | "ZHIHU_QUOTA_EXCEEDED";
export interface GateDecision { waitMs: number; blocked?: { code: ZhihuLimitCode; until: number }; }
export interface ProfileRequestGate {
  reserve(key: string, now: number, intervalMs: number): Promise<GateDecision>;
  check(key: string, now: number): Promise<GateDecision>;
  block(key: string, until: number, code: ZhihuLimitCode, now: number): Promise<void>;
}
interface Entry { next: number; until: number; code: ZhihuLimitCode; }
const maxQueueMs = 5_000;
export class InMemoryProfileRequestGate implements ProfileRequestGate {
  private readonly entries = new Map<string, Entry>();
  async reserve(key: string, now: number, intervalMs: number): Promise<GateDecision> {
    const current = this.entries.get(key) ?? { next: now, until: 0, code: "ZHIHU_RATE_LIMITED" as const };
    if (current.until > now) return { waitMs: 0, blocked: { code: current.code, until: current.until } };
    const scheduled = Math.max(now, current.next);
    if (scheduled-now > Math.max(maxQueueMs,intervalMs)) return { waitMs: 0, blocked: { code: "ZHIHU_RATE_LIMITED", until: scheduled } };
    current.next = scheduled + intervalMs;
    this.entries.set(key, current);
    return { waitMs: scheduled-now };
  }
  async check(key: string, now: number): Promise<GateDecision> {
    const current = this.entries.get(key);
    return current && current.until > now ? { waitMs: 0, blocked: { code: current.code, until: current.until } } : { waitMs: 0 };
  }
  async block(key: string, until: number, code: ZhihuLimitCode, now: number): Promise<void> {
    const current = this.entries.get(key) ?? { next: now, until: 0, code };
    if (current.until <= now) current.code = code;
    else if (code === "ZHIHU_QUOTA_EXCEEDED" || current.code !== "ZHIHU_QUOTA_EXCEEDED") current.code = code;
    current.until = Math.max(until,current.until);
    this.entries.set(key,current);
  }
}

// Only a hash of the server credential, timestamps and an allowlisted code enter Redis.
// Every instance using this credential shares spacing and upstream cooldowns.
const script = `
local now = tonumber(ARGV[2])
local value = redis.call('GET', KEYS[1])
local entry = value and cjson.decode(value) or {next=now, untilAt=0, code='ZHIHU_RATE_LIMITED'}
if ARGV[1] == 'block' then
  local untilAt = tonumber(ARGV[3])
  if entry.untilAt <= now or ARGV[4] == 'ZHIHU_QUOTA_EXCEEDED' or entry.code ~= 'ZHIHU_QUOTA_EXCEEDED' then entry.code=ARGV[4] end
  entry.untilAt=math.max(untilAt,entry.untilAt)
elseif entry.untilAt > now then
  return {0, entry.untilAt, entry.code}
elseif ARGV[1] == 'reserve' then
  local scheduled = math.max(now, entry.next)
  if scheduled-now > math.max(5000,tonumber(ARGV[3])) then return {0, scheduled, 'ZHIHU_RATE_LIMITED'} end
  entry.next = scheduled + tonumber(ARGV[3])
  redis.call('SET', KEYS[1], cjson.encode(entry), 'PX', math.max(60000, entry.next-now+60000))
  return {scheduled-now, 0, ''}
else return {0, 0, ''} end
redis.call('SET', KEYS[1], cjson.encode(entry), 'PX', math.max(60000, entry.untilAt-now+60000, entry.next-now+60000))
return {0, 0, ''}
`;
export class RedisProfileRequestGate implements ProfileRequestGate {
  constructor(private readonly client: Pick<RedisClientType,"eval">, private readonly prefix: string) {}
  private async call(key: string, args: string[]): Promise<GateDecision> {
    const value = await this.client.eval(script, { keys: [`${this.prefix}:profile:zhihu:${key}`], arguments: args }) as unknown as [number,number,string];
    if (!Array.isArray(value) || value.length !== 3 || !Number.isFinite(Number(value[0])) || !Number.isFinite(Number(value[1]))) throw new Error("PROFILE_THROTTLE_UNAVAILABLE");
    const until = Number(value[1]);
    if (until > 0) {
      if (value[2] !== "ZHIHU_RATE_LIMITED" && value[2] !== "ZHIHU_QUOTA_EXCEEDED") throw new Error("PROFILE_THROTTLE_UNAVAILABLE");
      return { waitMs: 0, blocked: { until, code: value[2] } };
    }
    return { waitMs: Math.max(0, Number(value[0])) };
  }
  reserve(key: string, now: number, intervalMs: number) { return this.call(key,["reserve",String(now),String(intervalMs)]); }
  check(key: string, now: number) { return this.call(key,["check",String(now)]); }
  async block(key: string, until: number, code: ZhihuLimitCode, now: number) { await this.call(key,["block",String(now),String(until),code]); }
}
