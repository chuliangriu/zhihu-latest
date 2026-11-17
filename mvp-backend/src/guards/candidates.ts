import type { CandidateExpression } from "../contracts/schemas.js";

export function filterDisplayableCandidates(
  candidates: CandidateExpression[],
  nowMs = Date.now(),
  recentDays = 7,
  publicRecentDays = recentDays,
  requirePublishedPublicTime = false,
  allowPublicDemoTime = false
): CandidateExpression[] {
  const earliest = nowMs - recentDays * 86_400_000;
  const seenAuthors = new Set<string>();

  return candidates.filter((candidate) => {
    const publishedAt = Date.parse(candidate.source.publishedAt);
    // Synthetic samples are authored fixtures, not verified people or posts.
    // Their explicit sample marker replaces source verification for eligibility.
    const sourceIsEligible = candidate.source.sourceType === "synthetic_private"
      ? candidate.source.timestampKind === "sample_created"
      : candidate.source.verified;
    const allowed =
      sourceIsEligible &&
      candidate.permission.discoverable &&
      candidate.permission.status === "active" &&
      Number.isFinite(publishedAt) &&
      (!requirePublishedPublicTime || candidate.source.sourceType !== "public" ||
        ((candidate.source.timestampKind === "published" || (allowPublicDemoTime && candidate.source.timestampKind === "sample_created")) && publishedAt <= nowMs)) &&
      publishedAt >= (candidate.source.sourceType === "public" ? nowMs - publicRecentDays * 86_400_000 : earliest) &&
      publishedAt <= nowMs + 60_000 &&
      !seenAuthors.has(candidate.authorId);

    if (allowed) seenAuthors.add(candidate.authorId);
    return allowed;
  });
}

export function isZhihuUrl(value: string | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["www.zhihu.com", "zhihu.com", "zhuanlan.zhihu.com"].includes(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}
