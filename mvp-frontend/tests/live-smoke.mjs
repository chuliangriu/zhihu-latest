// Explicit opt-in: npm run test:live. Uses synthetic input and real model quota.
// Uses a fresh local HTTP test session, never a browser's credentials.
import assert from 'node:assert/strict';
import { createApi } from '../public/mvp-api.js';
import { createLiveController } from '../public/mvp-live.js';
import { entryView } from '../public/mvp-entry.js';
const origin='http://127.0.0.1:4174';let cookie='',html='';
const api=createApi(async(path,options)=>{
  const response=await fetch(origin+path,{...options,headers:{...options.headers,Origin:origin,...(cookie?{Cookie:cookie}:{})}});
  const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];
  return response;
});
const c=createLiveController({api,render:state=>{html=entryView(state);},schedule:()=>1,cancel:()=>{}});
c.initialize();await c.action('start');await c.action('enter-chat');
assert.equal(c.getState().sessionReady,true);assert.equal(c.getState().sampleScenario,null);
assert.doesNotMatch(html,/退潮信箱|Mika/);
console.log('PASS current-user empty chat');
c.input('chatDraft','我下班后一直在画插画，发出去几乎没人看。我还想画，但越来越不知道怎么判断自己有没有进步。');
await c.action('send-chat');assert.equal(c.getState().error,'');assert.ok(c.getState().conversationId);
console.log('PASS real SSE reply:',c.getState().user.chat.at(-1).text);
console.log('Discovery candidates:',Object.keys(c.getState().user.candidates).length);
assert.doesNotMatch(html,/data-action="leave-paper"/);
// Paper endpoints are tested directly: do not reintroduce a product UI entry
// or pretend a synthetic candidate can receive the test paper.
const draft=await api.json('/api/papers/drafts',{conversationId:c.getState().conversationId,confirmedProfile:null});
assert.equal(draft.status,'draft');
console.log('PASS real generated paper:',JSON.stringify({subject:draft.subject,quote:draft.quote,background:draft.background}));
const edited=await api.json(`/api/papers/${draft.id}`,{expectedVersion:draft.version,subject:draft.subject,quote:draft.quote,context:'下班后画插画的人',background:draft.background},'PATCH');
assert.equal(edited.version,2);
const confirmed=await api.json(`/api/papers/${draft.id}/confirm`,{expectedVersion:edited.version,discoverableDays:7,identityDisclosure:'nickname',contactAllowed:true,target:{kind:'mailbox_only'}});
assert.equal(confirmed.paper.status,'active');
console.log('PASS edited and confirmed paper');
const saved=confirmed.paper;
const cross=await fetch(origin+`/api/papers/${saved.id}/withdraw`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});assert.equal(cross.status,401);
const forbidden=await fetch(origin+`/api/papers/${saved.id}/withdraw`,{method:'POST',headers:{Origin:'https://example.invalid',Cookie:cookie,'Content-Type':'application/json'},body:'{}'});assert.equal(forbidden.status,403);
const withdrawn=await api.json(`/api/papers/${saved.id}/withdraw`,{});assert.equal(withdrawn.status,'withdrawn');
console.log('PASS withdrawal, unauthenticated and cross-origin rejection');
