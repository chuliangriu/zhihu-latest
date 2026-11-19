import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveController } from '../public/mvp-live.js';
import { entryView } from '../public/mvp-entry.js';

test('a discovery JSON failure does not discard an already completed chat reply', async () => {
  let html = '';
  const api = {
    async json(path) {
      if (path === '/api/auth-me') return { success: true, localDevelopment: true, user: { id: 'user-1', display_name: '测试用户', avatar_url: null } };
      if (path.includes('/discovery')) throw new Error('LLM_OUTPUT_NOT_JSON');
      throw new Error(`unexpected path: ${path}`);
    },
    async chat(_conversationId, _message, onDelta, _signal, onAnswerComplete) {
      onDelta('这是一段已经完成的正常回复。');
      onAnswerComplete({ conversationId: 'conversation-1', userMessageId: 'user-1', assistantMessageId: 'assistant-1' });
      return { conversationId: 'conversation-1', assistantMessageId: 'assistant-1', discovery: { eligible: true, topicKey: 'writing' } };
    }
  };
  const controller = createLiveController({ api, render: state => { html = entryView(state); } });
  controller.initialize();
  await controller.action('start');
  await controller.action('enter-chat');
  controller.input('chatDraft', '我想讲讲最近卡住的一件事。');
  await controller.action('send-chat');

  assert.equal(controller.getState().error, '');
  assert.match(html, /这是一段已经完成的正常回复。/);
  assert.match(html, /这次没能整理出相关的纸条，但刚才的聊天已经完成。你可以继续说。/);
});

for (const [reasonCode,notice] of [
  ['zhihu_rate_limited','知乎搜索触发频率限制'],
  ['zhihu_quota_exceeded','知乎搜索额度暂不可用'],
  ['zhihu_auth_failed','这次匹配暂时没有完成'],
]) test(`discovery ${reasonCode} stays distinct from a normal no-match`,async()=>{
  const api={
    async json(path){
      if(path==='/api/auth-me')return {success:true,localDevelopment:true,user:{id:'user-1',display_name:'测试用户'}};
      if(path.includes('/discovery'))return {status:'unavailable',reasonCode,matches:{situationClose:null,structureRelated:null}};
      throw new Error('unexpected path');
    },
    async chat(_conversationId,_message,onDelta){onDelta('已经完成的聊天。');return {conversationId:'conversation-1',assistantMessageId:'assistant-1',discovery:{eligible:true,topicKey:'writing'}};}
  };
  const c=createLiveController({api,render:()=>{}});c.initialize();await c.action('start');await c.action('enter-chat');
  c.input('chatDraft','我想聊聊最近正在做的一件事。');await c.action('send-chat');
  const outcome=c.getState().user.chat.at(-1);
  assert.ok(outcome.text.includes(notice));assert.equal(outcome.offerPaper,true);
  assert.doesNotMatch(outcome.text,/没有找到有具体关联/);
  assert.equal(c.getState().discoveryDiagnostic.reasonCode,reasonCode);
  assert.ok(entryView(c.getState()).includes('data-action="copy-discovery-diagnostic"'));
  assert.ok(c.getState().user.chat.some(m=>m.text==='已经完成的聊天。'));
});


function outcomeHarness({result,eligible=true,reasonCode='first_topic_allowed',error}={}) {
  let html='';const frames=[];const c=createLiveController({render:s=>{html=entryView(s);frames.push(html);},api:{
    async json(path){
      if(path==='/api/auth-me')return {success:true,localDevelopment:true,user:{id:'test-outcome',display_name:'测试用户'}};
      if(path.includes('/discovery')){if(error)throw error;return result;}
      throw Error('Unexpected route '+path);
    },
    async chat(_id,_text,onDelta,_signal,onAnswerComplete){onDelta('已经认真听完你的表达。');onAnswerComplete({conversationId:'conversation-1'});return {conversationId:'conversation-1',assistantMessageId:'assistant-1',discovery:{eligible,reasonCode,topicKey:'making-something'}};}
  }});
  return {c,frames,get html(){return html;},async send(){await c.action('start');await c.action('enter-chat');c.input('chatDraft','我做了一个自己的项目，但迟迟不敢给别人看。');await c.action('send-chat');}};
}

test('no match becomes a visible Kanshan invitation and opens the original paper consent flow',async()=>{
  const h=outcomeHarness({result:{status:'no_match',reasonCode:'no_reliable_relation',matches:{situationClose:null,structureRelated:null}}});await h.send();
  const log=h.html.slice(0,h.html.indexOf('<div class="kanshan-composer">'));
  assert.match(log,/这次暂时没有找到有具体关联的表达/);assert.match(log,/要不要把刚才聊到的事留成一张纸条/);
  assert.match(log,/data-action="leave-paper"/);assert.doesNotMatch(h.html,/mvp-paper-tools|data-action="open-mailbox"/);
  assert.equal(h.c.getState().chatNotice,'');assert.equal(h.c.getState().discoveryDiagnostic.status,'no_match');
  await h.c.action('leave-paper');assert.equal(h.c.getState().screen,'consent');assert.match(h.html,/mailbox-consent-card/);
});

test('answer completion does not claim to be searching when the topic is not eligible',async()=>{
  const h=outcomeHarness({eligible:false,reasonCode:'not_personal_situation'});await h.send();
  assert.equal(h.c.getState().discoveryDiagnostic,null);assert.doesNotMatch(h.frames.join(''),/我在看看有没有相关|我再找找|data-action="leave-paper"/);
});

test('a topic-assessment failure also offers a paper without claiming a search succeeded',async()=>{
  const h=outcomeHarness({eligible:false,reasonCode:'topic_assessment_unavailable'});await h.send();
  assert.equal(h.c.getState().discoveryDiagnostic.stage,'topic');assert.match(h.html,/暂时没能判断/);assert.match(h.html,/data-action="leave-paper"/);
});

test('HTTP upstream limits retain a safe request ID and remain distinct from a successful empty search',async()=>{
  const h=outcomeHarness({error:Object.assign(Error('upstream error'),{code:'zhihu_rate_limited',requestId:'test-request-42'})});await h.send();
  assert.match(h.html,/知乎搜索触发频率限制/);assert.doesNotMatch(h.html,/这次暂时没有找到有具体关联/);
  assert.deepEqual(h.c.getState().discoveryDiagnostic,{status:'unavailable',reasonCode:'zhihu_rate_limited',requestId:'test-request-42',stage:'matching'});
});


test('matching diagnostics do not retain arbitrary exception messages or private response data',async()=>{
  const h=outcomeHarness({error:Object.assign(Error('private-response-token-should-not-survive'),{raw:'private-content'})});await h.send();
  assert.equal(h.c.getState().discoveryDiagnostic.reasonCode,'DISCOVERY_REQUEST_FAILED');
  assert.doesNotMatch(JSON.stringify(h.c.getState().discoveryDiagnostic),/private-response|private-content/);
});
