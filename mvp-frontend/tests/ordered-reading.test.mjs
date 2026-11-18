import test from 'node:test';
import assert from 'node:assert/strict';
import { discoveryView } from '../public/mvp-api.js';
import { createEntryController, entryView } from '../public/mvp-entry.js';

function match(sourceType, path='situationClose') {
  return {candidateId:'candidate-1',path,sourceType,authorDisplayName:'作者',publishedAt:new Date().toISOString(),
    sourceUrl:sourceType==='public'?'https://www.zhihu.com/answer/123':null,contactable:true,
    sharedRelation:'你们都在等待作品的反馈。',evidenceRefs:[{side:'candidate',quote:'我还在写，只是暂时没有读者。'}]};
}
for (const sourceType of ['public','authorized_private']) test(`live ${sourceType} opens the shared card, then lets the reader decide`,()=>{
  const view=discoveryView({matches:{situationClose:match(sourceType)}},'用户');
  const controller=createEntryController({render:()=>{}}),state=controller.getState();
  Object.assign(state,{live:true,screen:'chat'});state.user.candidates=view.candidates;
  controller.action('view','A');
  assert.equal(state.screen,'card');
  const html=entryView(state);
  assert.match(html,/candidate-overlay-card/);assert.match(html,/你们都在等待作品的反馈/);
  assert.match(html,/先不回应/);assert.match(html,/回应 TA/);
  assert.doesNotMatch(html,/zh-public-discussion|zh-private-composer/);
  if(sourceType==='public'){
    assert.match(html,/candidate-public-source/);assert.match(html,/来自知乎公开表达/);
    assert.match(html,/href="https:\/\/www.zhihu.com\/answer\/123"/);
  }
  controller.action('write');assert.equal(state.screen,'consent');
  controller.action('back');assert.equal(state.screen,'card');
});
test('a single structure-related match is presented as the first choice',()=>{
  const view=discoveryView({matches:{structureRelated:match('public','structureRelated')}},'用户');
  assert.deepEqual(Object.keys(view.candidates),['A']);
  assert.equal(view.candidates.A.path,'structureRelated');
  const choice=view.messages.flatMap(m=>m.blocks??[]).find(b=>b.type==='choice');
  assert.equal(choice.text,'选择一');
});

test('assigned inventory dates show as ordinary dates while the reading card retains the original source URL',()=>{
  const publicMatch={...match('public'),timestampKind:'inventory_assigned'};
  const view=discoveryView({matches:{situationClose:publicMatch}},'用户');
  assert.equal(view.candidates.A.sourceUrl,publicMatch.sourceUrl);
  assert.doesNotMatch(view.candidates.A.time,/演示|样本|非原文/);
  const controller=createEntryController({render:()=>{}}),state=controller.getState();
  Object.assign(state,{live:true,screen:'chat'});state.user.candidates=view.candidates;
  controller.action('view','A');const html=entryView(state);
  assert.match(html,/来自知乎公开表达/);
  assert.match(html,/href="https:\/\/www.zhihu.com\/answer\/123"/);
  assert.doesNotMatch(html,/演示时间|非原文发布时间/);
});
