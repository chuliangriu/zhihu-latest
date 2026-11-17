// Explicit opt-in paid test. Isolated loopback process/store; never changes the
// normal 4174 server's 50/50 routing or sends a message on Zhihu.
import assert from 'node:assert/strict';
import http from 'node:http';
import { createLocalBackend } from '../local-backend.mjs';
import { createApi } from '../public/mvp-api.js';
import { createLiveController } from '../public/mvp-live.js';
import { entryView } from '../public/mvp-entry.js';
if(!process.argv.includes('--live'))throw new Error('Pass --live to permit model/search costs');
process.env.PUBLIC_SOURCE_PROBABILITY='1';
process.env.ZHIHU_PUBLIC_SEARCH_ENABLED='true';
process.env.ZHIHU_PUBLIC_DEMO_TIME_ENABLED='true';
let handler;
const server=http.createServer((req,res)=>handler(req,res));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
handler=createLocalBackend(origin);
let cookie='',html='',navigation=null;
const api=createApi(async(path,options)=>{
  const r=await fetch(origin+path,{...options,headers:{...options.headers,Origin:origin,...(cookie?{Cookie:cookie}:{})}});
  const header=r.headers.get('set-cookie');if(header)cookie=header.split(';')[0];return r;
});
let seq=0;const timers=new Map();
const c=createLiveController({api,render:state=>{html=entryView(state);},schedule:fn=>{timers.set(++seq,fn);return seq;},cancel:id=>timers.delete(id),navigate:url=>{navigation=url;}});
function finish(){for(let i=0;timers.size&&i<1000;i++){const [id,fn]=timers.entries().next().value;timers.delete(id);fn();}assert.equal(timers.size,0);}
try {
  c.initialize();await c.action('start');await c.action('enter-chat');
  c.input('chatDraft','这半年我和几个老朋友的联系几乎都靠我主动，每次我发消息他们也会回，但从不主动来找我。我试过一个月不联系，结果真的谁也没找我。我舍不得这些关系，又不知道这种只有我主动的友情是不是还值得继续。');
  await c.action('send-chat');assert.equal(c.getState().error,'');finish();
  const entries=Object.entries(c.getState().user.candidates);
  const entry=entries.find(([key,p])=>key==='B'&&p.sourceType==='public')??entries.find(([,p])=>p.sourceType==='public');
  assert.ok(entry,'This live run produced no grounded public match');
  await c.action('view',entry[0]);assert.equal(c.getState().screen,'public-preview');
  assert.match(html,/知乎/);assert.ok(entry[1].publicReference.url);
  await c.action('write');assert.equal(c.getState().screen,'consent');
  await c.action('confirm-consent');assert.equal(c.getState().error,'');assert.equal(c.getState().screen,'share');
  await c.action('deposit');assert.equal(c.getState().error,'');finish();
  assert.equal(c.getState().paper.status,'active');assert.doesNotMatch(html,/已递给/);
  await c.action('continue-public');
  c.input('publicDraft','我也一直在想，主动和被珍惜之间应该怎么分辨。');
  await c.action('send-public');
  // Handoff intentionally removes tracking parameters, never the original path.
  const original=new URL(entry[1].sourceUrl);original.search='';original.hash='';
  assert.equal(navigation,original.href);
  await c.action('withdraw-paper');assert.equal(c.getState().paper.status,'withdrawn');
  console.log(JSON.stringify({passed:true,selectedChoice:entry[0],sourceType:entry[1].sourceType,originalUrl:navigation,
    stages:['chat','public-discovery','original-preview','consent','own-paper','mailbox-only','original-handoff','withdrawal']}));
} finally { server.closeAllConnections();await new Promise(resolve=>server.close(resolve)); }
