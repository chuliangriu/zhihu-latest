// Explicit opt-in; real model quota, authored test input, no real contact.
import assert from 'node:assert/strict';
import {createApi} from '../public/mvp-api.js';
import {createLiveController} from '../public/mvp-live.js';
import {entryView} from '../public/mvp-entry.js';
const origin='http://127.0.0.1:4174';let sessionCookie='',html='',lastToken=0,replyDone=0,answerDone=0;
const api=createApi(async(path,options)=>{const r=await fetch(origin+path,{...options,headers:{...options.headers,Origin:origin,...(sessionCookie?{Cookie:sessionCookie}:{})}});const cookie=r.headers.get('set-cookie');if(cookie)sessionCookie=cookie.split(';')[0];return r;});
const chat=api.chat;api.chat=async(...args)=>{const delta=args[2],complete=args[4];args[2]=text=>{lastToken=performance.now();delta(text);};args[4]=value=>{answerDone=performance.now();complete?.(value);};const done=await chat(...args);replyDone=performance.now();return done;};
let seq=0;const timers=new Map();const c=createLiveController({api,render:state=>{html=entryView(state);},schedule:fn=>{timers.set(++seq,fn);return seq;},cancel:id=>timers.delete(id)});
function finish(){for(let i=0;timers.size&&i<1000;i++){const [id,fn]=timers.entries().next().value;timers.delete(id);fn();}assert.equal(timers.size,0);}
c.initialize();await c.action('start');await c.action('enter-chat');const start=performance.now();
c.input('chatDraft','我下班后一直在写一个故事，已经写了几个月。发出去几乎没人看，也没反馈。我还想写完人物的结局，但没有回应时不知道该不该继续。');await c.action('send-chat');
assert.equal(c.getState().error,'');
console.log(JSON.stringify({replyDoneMs:Math.round(replyDone-start),answerDoneMs:Math.round(answerDone-start),afterReplyWaitMs:Math.round(performance.now()-lastToken),matches:Object.keys(c.getState().user.candidates).length}));
finish();assert.doesNotMatch(html,/非真人|你，还有一件事儿/);
const entries=Object.entries(c.getState().user.candidates);
const entry=entries.find(([key,p])=>key==='B'&&p.synthetic)??entries.find(([,p])=>p.synthetic);assert.ok(entry,'No synthetic match in this real-model run');
console.log(JSON.stringify({selectedChoice:entry[0]}));
await c.action('view',entry[0]);assert.match(html,/<small class="synthetic-label">非真人<\/small>/);
await c.action('write');assert.equal(c.getState().screen,'consent');await c.action('confirm-consent');assert.equal(c.getState().error,'');assert.equal(c.getState().screen,'share');
await c.action('deposit');assert.equal(c.getState().error,'');assert.equal(c.getState().paper.status,'active');finish();assert.match(html,/纸条已投入信箱/);assert.doesNotMatch(html,/已递给/);
await c.action('continue-private');c.input('privateDraft','我想听听你为什么还想继续。');await c.action('send-private');assert.match(html,/不会实际发送/);
await c.action('withdraw-paper');assert.equal(c.getState().paper.status,'withdrawn');console.log('PASS synthetic card → consent → actual paper → mailbox → chat preview → withdrawal');
