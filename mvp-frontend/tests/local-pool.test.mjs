import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalWorkflowStore } from '../local-pool.mjs';
test('only confirmed unexpired papers enter local discovery; own papers and withdrawn papers never do',async()=>{
  const store=new LocalWorkflowStore(),signal=new AbortController().signal;
  const convo=await store.createConversation('owner');
  const p=await store.createPaperDraft({ownerId:'owner',conversationId:convo.id,subject:'画画',quote:'我还在画，但不知道有没有进步。',context:'下班后画画',background:'我一直在画画但缺少反馈。'});
  assert.deepEqual(await store.list('other',signal),[]);
  await store.confirmPaper({id:p.id,ownerId:'owner',expectedVersion:1,discoverableUntil:new Date(Date.now()+86400000).toISOString(),identityDisclosure:'nickname',contactAllowed:true});
  const found=await store.list('other',signal);assert.equal(found.length,1);assert.equal(found[0].permission.contactable,false);
  assert.deepEqual(await store.list('owner',signal),[]);
  await store.withdrawPaper(p.id,'owner');assert.deepEqual(await store.list('other',signal),[]);
});
