import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveController} from '../public/mvp-live.js';
import {entryView} from '../public/mvp-entry.js';
const id=()=>crypto.randomUUID();
const fields={id:id(),version:1,status:'draft',subject:'等待一个回声',quote:'我还想继续这件事，只是不知道下一步。',context:'持续投入',background:'这个人持续投入着一件重要的事，也在等待具体的反馈。'};
function harness(json) {
  let html='';const timers=[];
  const c=createLiveController({api:{json},render:s=>{html=entryView(s);},schedule:fn=>{timers.push(fn);return timers.length;},cancel:()=>{}});
  return {c,get html(){return html;},finish(){while(timers.length)timers.shift()();}};
}
const session={success:true,localDevelopment:true,user:{id:'owner',display_name:'测试用户'}};
const paperPreview=(own=false)=>({id:id(),status:'active',subject:'仍然等待回声',quote:'我也一直在等一个具体的回应。',background:'这个人仍在投入一件重要的事。',displayName:own?'你':'匿名用户',own});
const thread=()=>({id:id(),paper:paperPreview(),introduction:paperPreview(true),canReply:true,closedReason:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),messages:[]});

test('without any match a user can preview, edit and independently confirm a paper with explicit scope',async()=>{
  let confirmed,edited;const saved={...fields};
  const h=harness(async(path,body,method)=>{
    if(path==='/api/auth-me')return session;
    if(path==='/api/papers/drafts')return saved;
    if(path===`/api/papers/${saved.id}`&&method==='PATCH'){edited=body;Object.assign(saved,body,{version:2});return saved;}
    if(path.endsWith('/confirm')){confirmed=body;Object.assign(saved,body,{status:'active',version:3});return {paper:saved,delivery:null};}
    if(path==='/api/mailbox')return {papers:[saved],discussions:[],conversations:[]};
    if(path===`/api/papers/${saved.id}`)return saved;
    throw Error('Unexpected route '+path);
  });
  await h.c.action('start');await h.c.action('enter-chat');
  assert.match(h.html,/留一张自己的纸条/);assert.match(h.html,/我的纸条与交流/);
  await h.c.action('leave-paper');assert.match(h.c.getState().chatNotice,/先和看山聊聊/);
  h.c.getState().conversationId=id();await h.c.action('leave-paper');assert.match(h.html,/没有匹配/);
  await h.c.action('confirm-consent');assert.equal(h.c.getState().screen,'share');assert.match(h.html,/由你决定分享范围/);
  await h.c.action('edit-paper');h.c.input('paper-quote','我仍然愿意继续，也想听听不同的声音。');await h.c.action('save-paper-edit');assert.equal(edited.quote,'我仍然愿意继续，也想听听不同的声音。');
  h.c.input('matchingAllowed',false);h.c.input('identityDisclosure','anonymous');h.c.input('contactAllowed',false);
  await h.c.action('deposit');assert.equal(h.c.getState().screen,'deposit');h.finish();assert.equal(h.c.getState().screen,'delivered');
  assert.deepEqual(confirmed,{expectedVersion:2,discoverableDays:7,matchingAllowed:false,identityDisclosure:'anonymous',contactAllowed:false,target:{kind:'mailbox_only'}});
  assert.match(h.html,/不会参与新的匹配/);assert.doesNotMatch(h.html,/已递给|undefined/);
  await h.c.action('open-mailbox');assert.match(h.html,/等待一个回声/);
  await h.c.action('open-paper',saved.id);assert.match(h.html,/我仍然愿意继续/);
});

test('lost reply response preserves text and reuses the same message ID on retry',async()=>{
  let first=true;const requests=[],t=thread();
  const h=harness(async(path,body)=>{
    if(path.endsWith('/replies')){requests.push(body);if(first){first=false;t.messages.push({id:id(),own:true,content:body.content,createdAt:new Date().toISOString()});throw Error('Network failed after commit');}return t;}
    throw Error('Unexpected route '+path);
  });
  const s=h.c.getState();s.screen='discussion';s.discussion=t;s.sessionReady=true;
  h.c.input('replyDraft','这句话不要重复发送。');await h.c.action('send-discussion');
  assert.equal(s.replyDraft,'这句话不要重复发送。');assert.ok(s.replyPending);
  await h.c.action('send-discussion');assert.equal(requests.length,2);assert.equal(requests[0].clientMessageId,requests[1].clientMessageId);
  assert.equal(s.replyDraft,'');assert.equal(s.discussion.messages.length,1);
});

test('expired and withdrawn matching cards clear cached private text before opening',async()=>{
  for(const status of ['expired','withdrawn']) {
    const h=harness(async()=>({status,paper:null,contactable:false,discussionId:null}));
    const s=h.c.getState();s.screen='chat';s.discoveryId=id();s.user.candidates={A:{candidateId:id(),sourceType:'authorized_private',contact:true,quote:'旧的私密内容',profile:['旧背景'],shared:'旧关联'}};
    await h.c.action('view','A');assert.equal(s.screen,'chat');assert.equal(s.user.candidates.A.quote,'');assert.deepEqual(s.user.candidates.A.profile,[]);
    assert.equal(s.user.candidates.A.contact,false);assert.doesNotMatch(h.html,/旧的私密内容|旧背景/);
  }
});

test('history and discussion escape stored content, and a failed authorization clears cached history',async()=>{
  const t=thread();t.messages=[{id:id(),own:false,content:'<img src=x onerror=alert(1)>',createdAt:new Date().toISOString()}];
  const h=harness(async()=>{throw Object.assign(Error('UNAUTHENTICATED'),{code:'UNAUTHENTICATED'});});
  const s=h.c.getState();s.sessionReady=true;s.screen='discussion';s.discussion=t;s.mailbox={papers:[fields],discussions:[t],conversations:[]};
  assert.match(entryView(s),/&lt;img/);assert.doesNotMatch(entryView(s),/<img src=x/);
  await h.c.action('refresh-discussion');assert.equal(s.discussion,null);assert.equal(s.mailbox,null);assert.equal(s.screen,'login');assert.equal(s.authRequired,true);assert.match(h.html,/href="\/api\/zhihu-login"/);
});
