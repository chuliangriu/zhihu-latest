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
  assert.ok(c.getState().chatNotice.includes(notice));
  assert.doesNotMatch(c.getState().chatNotice,/没有找到有具体关联/);
  assert.ok(c.getState().user.chat.some(m=>m.text==='已经完成的聊天。'));
});
