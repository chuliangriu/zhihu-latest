import { containsForbiddenModelArtifact } from "../security/prompt-injection.js";
import type { Footprint, ProfileEvidenceIssue, ProfileModelOutput } from "./contracts.js";

// Diagnostics contain only fixed field paths and codes, never source IDs, quotes or model text.
export function profileEvidenceIssues(output: ProfileModelOutput, footprints: Footprint[]): ProfileEvidenceIssue[] {
  const issues: ProfileEvidenceIssue[] = [];
  const claims = output.background.map((claim, index) => ({ claim, path: `background.${index}` }));
  if (output.recentFocus) claims.push({ claim: output.recentFocus, path: "recentFocus" });
  for (const { claim, path } of claims) {
    if (/[<>\n\r]|【|】/.test(claim.text) || containsForbiddenModelArtifact([claim.text])) {
      issues.push({ path: `${path}.text`, code: "claim_text_invalid" });
    }
    for (const [index, ref] of claim.citations.entries()) {
      const evidence = footprints.find(f => f.id === ref.refId);
      const refPath = `${path}.citations.${index}`;
      if (!evidence) issues.push({ path: `${refPath}.refId`, code: "citation_ref_unknown" });
      else if (claim.kind === "self_report") {
        if (evidence.kind !== "creation") issues.push({ path: `${path}.kind`, code: "self_report_requires_creation" });
        else if (!evidence.summary.includes(ref.quote)) issues.push({ path: `${refPath}.quote`, code: "self_report_requires_summary_quote" });
      } else if (!evidence.title.includes(ref.quote) && !evidence.summary.includes(ref.quote)) {
        issues.push({ path: `${refPath}.quote`, code: "citation_quote_not_found" });
      }
    }
  }
  return issues.slice(0, 6);
}
