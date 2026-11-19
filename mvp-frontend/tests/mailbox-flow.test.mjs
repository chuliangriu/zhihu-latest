import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveController} from '../public/mvp-live.js';
import {entryView} from '../public/mvp-entry.js';
const id=()=>crypto.randomUUID();
const fields={id:id(),version:1,status:'draft',subject:'等待一个回声',quote:'我还想继续这件事，只是不知道下一步。',context:'持续投入',background:'这个人持续投入着一件重要的事，也在等待具体的反馈。'};
function harness(json) {
  let html='';const timers=[],delays=[];
  const c=createLiveController({api:{json},render:s=>{html=entryView(s);},schedule:(fn,ms)=>{timers.push(fn);delays.push(ms);return timers.length;},cancel:()=>{}});
  return {c,delays,get html(){return html;},finish(){while(timers.length)timers.shift()();}};
}
const session={success:true,localDevelopment:true,user:{id:'owner',display_name:'测试用户'}};
const paperPreview=(own=false)=>({id:id(),status:'active',subject:'仍然等待回声',quote:'我也一直在等一个具体的回应。',background:'这个人仍在投入一件重要的事。',displayName:own?'你':'匿名用户',own});
const thread=()=>({id:id(),paper:paperPreview(),introduction:paperPreview(true),canReply:true,closedReason:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),messages:[]});

test('without any match a user can preview, edit and independently confirm a paper with fixed, disclosed sharing rules',async()=>{
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
  await h.c.action('confirm-consent');assert.equal(h.c.getState().screen,'share');assert.match(h.html,/确认留下，即同意/);assert.match(h.html,/share-paper-content/);assert.doesNotMatch(h.html,/type="checkbox"|<select|由你决定分享范围/);
  await h.c.action('edit-paper');h.c.input('paper-quote','我仍然愿意继续，也想听听不同的声音。');await h.c.action('save-paper-edit');assert.equal(edited.quote,'我仍然愿意继续，也想听听不同的声音。');
  // Stale inputs cannot override the fixed rules disclosed in the confirmation page.
  h.c.input('matchingAllowed',false);h.c.input('identityDisclosure','anonymous');h.c.input('contactAllowed',false);
  await h.c.action('deposit');assert.equal(h.c.getState().screen,'deposit');assert.match(h.html,/deposit-paper/);assert.match(h.html,/deposit-kanshan/);assert.match(h.html,/kanshan-letter.png/);assert.equal(h.delays.at(-1),8400);h.finish();assert.equal(h.c.getState().screen,'delivered');
  assert.deepEqual(confirmed,{expectedVersion:2,discoverableDays:7,matchingAllowed:true,identityDisclosure:'nickname',contactAllowed:true,target:{kind:'mailbox_only'}});
  assert.match(h.html,/mailbox-delivered/);assert.match(h.html,/未来 7 天/);assert.doesNotMatch(h.html,/已递给|undefined/);
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


test('a mailbox read failure has a retry action and does not stay in a loading state',async()=>{
  const h=harness(async()=>{throw Object.assign(Error('STORE_UNAVAILABLE'),{code:'STORE_UNAVAILABLE'});});
  h.c.getState().sessionReady=true;
  await h.c.action('open-mailbox');
  assert.equal(h.c.getState().busy,false);
  assert.match(h.html,/data-action="refresh-mailbox"/);
  assert.doesNotMatch(h.html,/正在读取历史/);
});

test('a reply rejected after withdrawal refreshes the thread and removes the withdrawn cached text',async()=>{
  const t=thread();t.paper.quote='已被对方撤回的私人正文';t.paper.background='对方的旧背景';
  const h=harness(async(path)=>{
    if(path.endsWith('/replies'))throw Object.assign(Error('DISCUSSION_CLOSED'),{code:'DISCUSSION_CLOSED'});
    return {...t,canReply:false,closedReason:'paper_withdrawn',paper:{...t.paper,status:'withdrawn',subject:'已撤回的纸条',quote:null,background:null}};
  });
  const s=h.c.getState();s.screen='discussion';s.discussion=t;s.sessionReady=true;
  h.c.input('replyDraft','这条回复没有发送');await h.c.action('send-discussion');
  assert.equal(s.discussion.canReply,false);assert.equal(s.discussion.paper.quote,null);
  assert.equal(s.replyDraft,'这条回复没有发送');
  assert.doesNotMatch(h.html,/已被对方撤回的私人正文|对方的旧背景/);
  assert.match(h.html,/已有回复仍保留/);
});

test('a closed reply with a failed refresh clears stale thread content and offers history recovery',async()=>{
  const h=harness(async(path)=>{throw Object.assign(Error(path.endsWith('/replies')?'DISCUSSION_CLOSED':'STORE_UNAVAILABLE'),{code:path.endsWith('/replies')?'DISCUSSION_CLOSED':'STORE_UNAVAILABLE'});});
  const s=h.c.getState();s.screen='discussion';s.discussion=thread();s.discussion.paper.quote='不应继续展示的旧正文';s.sessionReady=true;
  h.c.input('replyDraft','仍未发送');await h.c.action('send-discussion');
  assert.equal(s.discussion,null);assert.equal(s.screen,'mailbox');
  assert.match(h.html,/data-action="refresh-mailbox"/);assert.doesNotMatch(h.html,/不应继续展示的旧正文|正在读取历史/);
});


test('failed confirmation keeps the draft preview and never plays a successful-deposit animation',async()=>{
  const h=harness(async()=>{throw Error('Confirmation unavailable');});
  const s=h.c.getState();s.sessionReady=true;s.screen='share';s.standalonePaper=true;s.paper={...fields};s.user.sharePaper=s.paper;
  await h.c.action('deposit');
  assert.equal(s.screen,'share');assert.equal(s.busy,false);assert.equal(s.paper.status,'draft');
  assert.doesNotMatch(h.html,/class="mailbox-stage"|class="mailbox-delivered"/);
  assert.match(h.html,/data-action="deposit"/);assert.equal(h.delays.length,0);
});

test('persisted discussions reuse the original private-chat window and paper design with real reply actions',()=>{
  const h=harness(async()=>{}),s=h.c.getState();s.screen='discussion';s.discussion=thread();s.sessionReady=true;s.replyDraft='还想接着聊';
  const html=entryView(s);
  for(const marker of ['zh-private-scene','zh-private-window','zh-private-history','zh-private-paper','zh-private-composer','private-hint-kanshan'])assert.ok(html.includes(marker),marker);
  assert.match(html,/id="discussion-message"/);assert.match(html,/data-action="send-discussion"/);
  assert.doesNotMatch(html,/data-action="send-private"|mailbox-panel/);
});

for(const sourceType of ['public','authorized_private'])test(`live ${sourceType} shares the original consent, animation and success designs`,()=>{
  const h=harness(async()=>{}),s=h.c.getState();s.sessionReady=true;s.selected='A';
  s.user.candidates={A:{name:'测试对象',sourceType}};s.paper={...fields};s.user.sharePaper=s.paper;
  s.delivery=sourceType==='authorized_private'?{status:'delivered'}:null;
  s.screen='consent';assert.match(entryView(s),/mailbox-consent-card/);
  s.screen='deposit';assert.match(entryView(s),/deposit-kanshan/);
  s.screen='delivered';const html=entryView(s);assert.match(html,/mailbox-deposit mailbox-delivered/);
  assert.match(html,sourceType==='public'?/data-action="continue-public"/:/data-action="continue-private"/);
  if(sourceType==='public')assert.doesNotMatch(html,/已递给/);
});
