export const PROFILE_FOOTPRINT_LIMIT_PER_KIND = 15;
export const PROFILE_FOOTPRINT_LOOKBACK_YEARS = 2;

// Application defaults, not a claim about Zhihu's undocumented QPS/reset rules.
export const DEFAULT_ZHIHU_DATA_POLICY = {
  minIntervalMs: 2_000,
  cooldownMs: 60_000,
  quotaCooldownMs: 15 * 60_000,
  cacheTtlMs: 5 * 60_000
};
export type ZhihuDataPolicy = typeof DEFAULT_ZHIHU_DATA_POLICY;
