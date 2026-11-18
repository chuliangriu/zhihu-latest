import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { loadSeedCandidates } from "../src/sources/routed-source.js";
import { filterDisplayableCandidates, isZhihuUrl } from "../src/guards/candidates.js";

it("loads all 100 assigned inventory dates without enabling the public demo-time flag, preserving every source",async()=>{
  const corpus=JSON.parse(await readFile(new URL('../data/zhihu-public-corpus.json',import.meta.url),'utf8'));
  const anchor=Date.parse(corpus.inventoryTimeAssignedAt);
  const strict=await loadSeedCandidates(()=>anchor,false),demo=await loadSeedCandidates(()=>anchor,true);
  expect(strict.publicCandidates).toHaveLength(100);
  expect(demo.publicCandidates).toEqual(strict.publicCandidates);
  for (const record of corpus.records) {
    const candidate=strict.publicCandidates.find(c=>c.candidateId===record.id)!;
    expect(candidate.source.url).toBe(record.url);expect(isZhihuUrl(candidate.source.url)).toBe(true);
    expect(candidate.source.sourceId).toBe(record.id);
    const indexed=corpus.items.find((item:{url:string})=>item.url===record.url);
    expect(indexed.publishedAt).toBe(record.publishedAt);
    expect(indexed.ageDays).toBe((anchor-Date.parse(record.publishedAt))/86400000);
    expect(candidate.authorDisplayName).toBe(record.authorName);
    expect(candidate.text).toBe(record.text.slice(0,4000));
    expect(candidate.permission.contactable).toBe(false);
    expect(candidate.source.timestampKind).toBe('inventory_assigned');
    expect(record.publicationTimeVerified).toBe(false);
    expect(Date.parse(record.publishedAt)).toBe(record.editTime*1000);
    const ageDays=(anchor-Date.parse(candidate.source.publishedAt))/86400000;
    expect(ageDays).toBeGreaterThanOrEqual(1);expect(ageDays).toBeLessThan(14);
    expect(filterDisplayableCandidates([candidate],anchor,7,14,true,false)).toHaveLength(1);
  }
  expect(new Set(strict.publicCandidates.map(c=>c.source.url)).size).toBe(100);
  // Existing one-author-per-batch policy remains effective.
  const eligible=filterDisplayableCandidates(strict.publicCandidates,anchor,7,14,true,false);
  expect(eligible).toHaveLength(new Set(strict.publicCandidates.map(c=>c.authorId)).size);
});

it("keeps assigned dates fixed across later reads and still excludes expired inventory",async()=>{
  const corpus=JSON.parse(await readFile(new URL('../data/zhihu-public-corpus.json',import.meta.url),'utf8'));
  const anchor=Date.parse(corpus.inventoryTimeAssignedAt),later=anchor+30*86400000;
  const current=await loadSeedCandidates(()=>anchor,false),future=await loadSeedCandidates(()=>later,false);
  expect(future.publicCandidates).toEqual(current.publicCandidates);
  expect(filterDisplayableCandidates(future.publicCandidates,later,7,14,true,false)).toEqual([]);
});
