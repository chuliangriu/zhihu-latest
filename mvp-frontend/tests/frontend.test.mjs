import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../public/', import.meta.url);
const script = readFileSync(new URL('app.js', root), 'utf8');
const chatStyles = readFileSync(new URL('chat-scene.css', root), 'utf8');

for (const [name, version, index] of [['Noah', 'v0.2', 0], ['Iris', 'v0.1', 1]]) {
test(`${name} LLM template snapshot stays aligned with the current frontend persona and dialogue`, () => {
  const snapshot = JSON.parse(readFileSync(new URL(`../test-fixtures/MVP/${name}标准输出样本.${version}.json`, import.meta.url), 'utf8'));
  const noah = JSON.parse(vm.runInNewContext(`${script.slice(0, script.indexOf('const state ='))}; JSON.stringify(mockUsers[${index}])`));
  assert.equal(snapshot.templateVersion, `${name.toLowerCase()}-output-${version}`);
  assert.deepEqual(snapshot.persona, {
    name: noah.name, role: noah.role, background: noah.background, detail: noah.detail, impression: noah.impression,
  });
  for (const field of ['chat', 'discoveryChat', 'candidates', 'sharePaper']) {
    assert.deepEqual(snapshot[field], noah[field], `${field}: update the LLM template snapshot when the frontend sample changes`);
  }
});
}

// DOM event harness: verifies navigation and timers, not visual rendering.
function demo() {
  const timers = new Map();
  let sequence = 0;
  const field = { value: '', focus() {}, listeners: {}, addEventListener(event, fn) { this.listeners[event] = fn; } };
  const log = { scrollTop: 0, scrollHeight: 1000 };
  const app = { innerHTML: '', classList: { toggle() {} } };
  let buttons = [];
  Object.defineProperty(app, 'innerHTML', {
    get() { return this.html || ''; },
    set(value) { this.html = value; const match = value.match(/<textarea id="(?:private-message|public-response)"[^>]*>([\s\S]*?)<\/textarea>/); if (match) field.value = match[1]; },
  });
  const document = {
    body: { dataset: {} },
    querySelector(selector) {
      if (selector === '#app') return app;
      if (selector === '#private-message' || selector === '#public-response') return field;
      if (selector === '[data-action="send-private"]') return buttons.find(b => b.dataset.action === 'send-private');
      if (selector === '[data-action="send-public"]') return buttons.find(b => b.dataset.action === 'send-public');
      if (selector === '.kanshan-body') return log;
      return { focus() {} };
    },
    querySelectorAll() {
      buttons = [...app.innerHTML.matchAll(/<button\b([^>]*data-action[^>]*)>/g)].map(([, attrs]) => ({
        dataset: Object.fromEntries([...attrs.matchAll(/data-([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v])),
        disabled: /\sdisabled(?:\s|$)/.test(attrs),
        addEventListener(_event, fn) { this.click = fn; },
      }));
      return buttons;
    },
  };
  vm.runInNewContext(script, { document, setTimeout(fn) { timers.set(++sequence, fn); return sequence; }, clearTimeout(id) { timers.delete(id); } });
  return {
    app, field, document, timers,
    type(value) { field.value = value; field.listeners.input(); },
    click(action, id, index = 0) {
      const button = buttons.filter(b => b.dataset.action === action && (!id || b.dataset.id === id))[index];
      assert.ok(button, `Missing button ${action} ${id || ''}`);
      button.click();
    },
    tick() { const entry = timers.entries().next().value; if (entry) { timers.delete(entry[0]); entry[1](); } },
    finish() { for (let i = 0; timers.size && i < 100; i++) this.tick(); assert.equal(timers.size, 0); },
  };
}

test('approved paper homepage has two actual persona entry points and local assets', () => {
  const d = demo();
  assert.equal(d.document.body.dataset.screen, 'home');
  assert.match(d.app.innerHTML, /paper-hero/);
  assert.match(d.app.innerHTML, /在知乎，答案和有答案的人已经很多了。/);
  assert.match(d.app.innerHTML, /但是此刻，在知乎，还有谁/);
  assert.doesNotMatch(d.app.innerHTML, /两个故事 · 一个起点|选择一个身份，体验一次相遇。/);
  assert.match(d.app.innerHTML, /paper-assets\/kanshan.png/);
  assert.equal((d.app.innerHTML.match(/data-action="choose"/g) || []).length, 2);
  assert.doesNotMatch(d.app.innerHTML, /style-switch|previewAssets|data:image/);
  for (const [, path] of d.app.innerHTML.matchAll(/src="\/(.*?)"/g)) assert.ok(existsSync(new URL(path, root)), path);
});

test('discovery styling separates the first person and keeps the second block unfilled', () => {
  assert.match(chatStyles, /\.discovery-continue\s*\{[^}]*margin-top:\s*30px/);
  assert.match(chatStyles, /\.discovery-focus\s*\{[^}]*background:\s*transparent/);
  assert.doesNotMatch(chatStyles, /\.discovery-focus\s*\{[^}]*background:\s*rgba\(222,\s*230,\s*229/);
});

test('Noah discovery choices stream in before the final person buttons appear', () => {
  const d = demo();
  d.click('choose', 'xutang');
  d.click('enter-chat');
  for (let i = 0; i < 6; i++) d.tick();
  assert.match(d.app.innerHTML, /is-streaming/);
  assert.doesNotMatch(d.app.innerHTML, /我知道现在没人看，可每次准备停下来/);
  assert.doesNotMatch(d.app.innerHTML, /class="kanshan-choices"/);
  d.finish();
  assert.doesNotMatch(d.app.innerHTML, /is-streaming/);
  assert.match(d.app.innerHTML, /class="kanshan-choices"/);
});

test('Noah discovery thinking delays are halved before typewriter playback', () => {
  assert.match(script, /delay: 2000/);
  assert.match(script, /delay: 2200, typewriter: true/);
  assert.match(script, /delay: 2700, typewriter: true/);
  assert.match(script, /state\.stage === 0 \? 900/);
  assert.match(script, /delay \|\| 1300/);
  assert.match(script, /state\.typedChars \+ 6/);
  assert.match(script, /\}, 38\)/);
  assert.doesNotMatch(script, /delay: 4000|delay: 4400|delay: 5400|\? 1800|\|\| 2600|typedChars \+ 12|\}, 28\)/);
});

for (const id of ['xutang']) {
  test(`${id}: paper delivery pauses before optional private chat`, () => {
    const d = demo();
    d.click('choose', id);
    assert.equal(d.document.body.dataset.screen, 'login');
    assert.match(d.app.innerHTML, /avatar-img large/);
    assert.match(d.app.innerHTML, /Demo 人物背景/);
    assert.doesNotMatch(d.app.innerHTML, /刘看山说：|基于这些，我对/);
    assert.match(d.app.innerHTML, /class="impression-focus"/);
    assert.match(d.app.innerHTML, /最近最明显的一条线/);
    assert.match(d.app.innerHTML, /这是进入故事前的有限背景/);
    assert.doesNotMatch(d.app.innerHTML, /借用 .* 的视角进入 Demo|不会登录知乎|读取你的真实账号信息/);
    if (id === 'xutang') {
      assert.match(d.app.innerHTML, /《退潮信箱》/);
      assert.doesNotMatch(d.app.innerHTML, /建筑学大四/);
    } else {
      assert.match(d.app.innerHTML, /建筑学大四/);
      assert.doesNotMatch(d.app.innerHTML, /《退潮信箱》/);
    }
    d.click('enter-chat');
    assert.match(d.app.innerHTML, /zh-backdrop/);
    assert.match(d.app.innerHTML, /kanshan-window/);
    assert.match(d.app.innerHTML, /paper-kanshan/);
    assert.doesNotMatch(d.app.innerHTML, /<header>/);
    d.tick();
    d.click('collapse-chat');
    assert.equal(d.timers.size, 0);
    assert.doesNotMatch(d.app.innerHTML, /class="kanshan-window"/);
    d.click('toggle-chat');
    d.finish();
    if (id === 'xutang') {
      assert.match(d.app.innerHTML, /这个话题有点戳到我了，让我先去找找知乎上有没有人聊过类似的经历。/);
      assert.match(d.app.innerHTML, /你还想知道故事里的人最后会怎样吗/);
      assert.match(d.app.innerHTML, /第 47 封信：地址已经消失，收件人仍然存在/);
      assert.match(d.app.innerHTML, /也是那些还没有抵达的信/);
      assert.match(d.app.innerHTML, /Noah，还有一件事儿。刚才在帮你找别人的经历时，我听到其他“看山”告诉我/);
      assert.match(d.app.innerHTML, /这周，还有 6 个和你一样的人，也卡在这儿/);
      assert.match(d.app.innerHTML, /kanshan-found-choice">选择一/);
      assert.match(d.app.innerHTML, /kanshan-found-time">2 天前/);
      assert.match(d.app.innerHTML, /我想起了其中一个还在写的人/);
      assert.match(d.app.innerHTML, /把一句没有说完的话留给他的“看山”/);
      assert.match(d.app.innerHTML, /和你一样，他也在写作/);
      assert.match(d.app.innerHTML, /只是我又想到一个人/);
      assert.match(d.app.innerHTML, /kanshan-found-choice">选择二/);
      assert.match(d.app.innerHTML, /kanshan-found-time">3 天前，他这样说/);
      assert.match(d.app.innerHTML, /class="kanshan-message agent continuation discovery-focus"/);
      assert.match(d.app.innerHTML, /他没有在写小说，但和你一样的是/);
      assert.match(d.app.innerHTML, /我已经把能做的那部分做完了，可一直没有回应/);
      assert.doesNotMatch(d.app.innerHTML, /工作交出去以后，如果领导没说什么/);
      assert.match(d.app.innerHTML, /class="kanshan-found-quote"/);
      assert.doesNotMatch(d.app.innerHTML, /Mika|她没有在写小说|她说/);
      assert.equal((d.app.innerHTML.match(/<span class="kanshan-speaker">看山<\/span>/g) || []).length, 2);
      assert.ok(d.app.innerHTML.indexOf('我想起了其中一个还在写的人') < d.app.innerHTML.indexOf('只是我又想到一个人'));
    }
    assert.equal(d.document.body.dataset.screen, 'chat');
    assert.match(d.app.innerHTML, /class="kanshan-choices"/);
    assert.match(d.app.innerHTML, />第一个人<.*>第二个人</s);
    assert.doesNotMatch(d.app.innerHTML, /data-action="discover"|class="directions"/);
    assert.doesNotMatch(d.app.innerHTML, /A · 处境相近|B · 结构相关|查看 A|查看 B|更适合你/);
    assert.equal((d.app.innerHTML.match(/data-action="view"/g) || []).length, 2);
    d.click('view', 'B');
    assert.match(d.app.innerHTML, id === 'xutang' ? /Mika/ : /June/);
    assert.match(d.app.innerHTML, /candidate-overlay-layer/);
    assert.match(d.app.innerHTML, /candidate-overlay-card/);
    assert.match(d.app.innerHTML, /kanshan-window is-obscured/);
    if (id === 'xutang') {
      assert.match(d.app.innerHTML, /Mika 刚开始工作一年/);
      assert.match(d.app.innerHTML, /最近最让她拿不准的/);
    }
    assert.doesNotMatch(d.app.innerHTML, /关于这个人|为什么可能与你有关|但你们并不一样|接下来会发生什么|Demo Mock/);
    d.click('write');
    assert.equal(d.document.body.dataset.screen, 'consent');
    assert.match(d.app.innerHTML, /在去见 .* 之前，要不要也留下一张纸/);
    assert.match(d.app.innerHTML, /看山们的信箱/);
    assert.match(d.app.innerHTML, /class="mailbox-mini-icon"/);
    assert.match(d.app.innerHTML, /未来 7 天/);
    assert.match(d.app.innerHTML, /不会公开完整聊天，也可以随时收回/);
    d.click('confirm-consent');
    assert.equal(d.document.body.dataset.screen, 'share');
    assert.match(d.app.innerHTML, /candidate-overlay-card share-paper-card/);
    assert.match(d.app.innerHTML, /准备投入看山们的信箱/);
    assert.match(d.app.innerHTML, /由看山根据刚才的对话整理/);
    assert.doesNotMatch(d.app.innerHTML, /等待你的逐条确认/);
    assert.match(d.app.innerHTML, /可发现范围/);
    assert.doesNotMatch(d.app.innerHTML, /投入信箱后，这张纸也会递给/);
    assert.match(d.app.innerHTML, /投入信箱，也递给/);
    assert.doesNotMatch(d.app.innerHTML, /私人首信，是两份不同的内容/);
    if (id === 'xutang') assert.match(d.app.innerHTML, /我写了十一个月的《退潮信箱》/);
    d.click('deposit');
    assert.equal(d.document.body.dataset.screen, 'deposit');
    assert.match(d.app.innerHTML, /正在把这张纸投入信箱/);
    assert.doesNotMatch(d.app.innerHTML, /纸条已投入信箱，也已递给/);
    assert.match(d.app.innerHTML, /shared-mailbox/);
    assert.match(d.app.innerHTML, /paper-assets\/kanshan-letter\.png/);
    d.tick();
    assert.equal(d.document.body.dataset.screen, 'delivered');
    assert.equal(d.timers.size, 0);
    assert.match(d.app.innerHTML, /纸条已投入信箱，也已递给/);
    d.tick();
    assert.equal(d.document.body.dataset.screen, 'delivered');
    d.click('continue-private');
    assert.equal(d.document.body.dataset.screen, 'private');
    assert.match(d.app.innerHTML, /zh-private-window/);
    assert.match(d.app.innerHTML, /zh-backdrop/);
    assert.match(d.app.innerHTML, /zh-private-paper/);
    assert.match(d.app.innerHTML, id === 'xutang' ? /id="private-title">Mika/ : /id="private-title">June/);
    assert.match(d.app.innerHTML, /写一句只想让 .* 看见的话/);
    assert.match(d.app.innerHTML, /想接着对 .* 说些什么？/);
    assert.doesNotMatch(d.app.innerHTML, /送出这封信|看见了你的信/);
    d.click('send-private');
    assert.doesNotMatch(d.app.innerHTML, /class="zh-private-bubble"/);
    d.type('我也在等一个回应。<不是代码>');
    d.click('send-private');
    assert.match(d.app.innerHTML, /&lt;不是代码&gt;/);
    assert.equal(d.document.body.dataset.screen, 'private');
    assert.equal(d.field.value, '');
    d.type('还没发出的草稿');
    d.click('close-private');
    assert.equal(d.document.body.dataset.screen, 'delivered');
    d.click('continue-private');
    assert.match(d.app.innerHTML, /我也在等一个回应/);
    assert.equal(d.field.value, '还没发出的草稿');
    assert.equal((d.app.innerHTML.match(/class="zh-private-paper"/g) || []).length, 1);
    let prevented = false;
    d.field.listeners.keydown({ key: 'Enter', isComposing: true, preventDefault() { prevented = true; } });
    assert.equal(prevented, false);
    d.field.listeners.keydown({ key: 'Enter', shiftKey: true, preventDefault() { prevented = true; } });
    assert.equal(prevented, false);
    d.field.listeners.keydown({ key: 'Enter', preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal((d.app.innerHTML.match(/class="zh-private-bubble"/g) || []).length, 2);
    d.click('close-private');
    d.click('finish-delivery');
    assert.equal(d.document.body.dataset.screen, 'chat');
    assert.equal(d.timers.size, 0);
    assert.match(d.app.innerHTML, /你刚才选择了第二个人/);
    assert.doesNotMatch(d.app.innerHTML, /class="kanshan-choices"|zh-private-window/);
    d.click('back-home');
    assert.equal(d.document.body.dataset.screen, 'home');
    assert.equal(d.timers.size, 0);
  });
}

test('Iris streams both options and deposits her paper before returning to the public discussion', () => {
  const d = demo();
  d.click('choose', 'iris');
  assert.match(d.app.innerHTML, /建筑学大四/);
  assert.match(d.app.innerHTML, /class="impression-focus"/);
  d.click('enter-chat');
  for (let i = 0; i < 6; i++) d.tick();
  assert.match(d.app.innerHTML, /is-streaming/);
  assert.doesNotMatch(d.app.innerHTML, /class="kanshan-choices"/);
  d.finish();
  assert.match(d.app.innerHTML, /选择一/);
  assert.match(d.app.innerHTML, /选择二/);
  assert.match(d.app.innerHTML, /2 天前/);
  assert.match(d.app.innerHTML, /3 天前，他在评论里这样说/);
  assert.match(d.app.innerHTML, /知乎的一篇文章下面/);
  assert.match(d.app.innerHTML, /没有得到赞同或回复/);
  d.click('view', 'A');
  d.click('write');
  assert.equal(d.document.body.dataset.screen, 'card');
  d.click('back');
  d.click('view', 'B');
  assert.equal(d.document.body.dataset.screen, 'public-preview');
  assert.match(d.app.innerHTML, /zh-public-window/);
  assert.match(d.app.innerHTML, /知乎 · 文章评论/);
  assert.match(d.app.innerHTML, /一篇文章，怎样才能让读者愿意继续读下去/);
  assert.match(d.app.innerHTML, /Demo 文章与评论 · 由知乎公开讨论改编/);
  assert.match(d.app.innerHTML, /按互动和热度展开的评论区里/);
  assert.match(d.app.innerHTML, /赞同 0/);
  assert.match(d.app.innerHTML, /反对 0/);
  assert.match(d.app.innerHTML, /回复 0/);
  assert.match(chatStyles, /\.zh-public-window\s*\{[^}]*width:\s*min\(700px,[^}]*max-width:\s*700px/);
  assert.doesNotMatch(d.app.innerHTML, /索引卡|candidate-overlay-card|candidate-profile|研一|public-response|send-public/);
  assert.match(d.app.innerHTML, /question\/45382314\/answer\/100891132/);
  assert.doesNotMatch(d.app.innerHTML, /建筑怎么才能让人们有想停留的欲望/);
  d.click('write');
  assert.equal(d.document.body.dataset.screen, 'consent');
  assert.match(d.app.innerHTML, /回到知乎回应之前/);
  assert.doesNotMatch(d.app.innerHTML, /索引卡/);
  assert.doesNotMatch(d.app.innerHTML, /你能看见 June，是因为他允许/);
  d.click('back');
  assert.equal(d.document.body.dataset.screen, 'public-preview');
  assert.doesNotMatch(d.app.innerHTML, /public-response|send-public/);
  d.click('write');
  d.click('confirm-consent');
  assert.match(d.app.innerHTML, /share-paper-name">Iris/);
  assert.match(d.app.innerHTML, /data-action="deposit">投入看山们的信箱/);
  assert.doesNotMatch(d.app.innerHTML, /也递给 June|data-action="continue-public"/);
  d.click('deposit');
  assert.doesNotMatch(d.app.innerHTML, /递给 June/);
  d.tick();
  assert.equal(d.document.body.dataset.screen, 'delivered');
  assert.equal(d.timers.size, 0);
  assert.match(d.app.innerHTML, /纸条已投入信箱。/);
  assert.doesNotMatch(d.app.innerHTML, /递给 June|data-action="continue-private"/);
  d.click('continue-public');
  assert.equal(d.document.body.dataset.screen, 'public');
  assert.match(d.app.innerHTML, /zh-public-window/);
  assert.match(d.app.innerHTML, /private-hint-kanshan/);
  assert.match(d.app.innerHTML, /也让路过的人看见/);
  assert.doesNotMatch(d.app.innerHTML, /只想让|zh-private-paper|private-message/);
  d.click('send-public');
  assert.doesNotMatch(d.app.innerHTML, /刚刚 · 演示回应/);
  d.type('我想到了家里的客厅。<script>');
  d.field.listeners.keydown({ key: 'Enter', isComposing: true });
  assert.doesNotMatch(d.app.innerHTML, /刚刚 · 演示回应/);
  d.click('send-public');
  assert.match(d.app.innerHTML, /&lt;script&gt;/);
  assert.match(d.app.innerHTML, /刚刚 · 演示回应，仅当前页面可见/);
  assert.equal(d.field.value, '');
  d.type('还想补充一点');
  d.click('close-public');
  d.click('continue-public');
  assert.equal(d.field.value, '还想补充一点');
  assert.match(d.app.innerHTML, /我想到了家里的客厅/);
  d.field.listeners.keydown({ key: 'Enter', preventDefault() {} });
  assert.equal(d.field.value, '');
  d.click('close-public');
  d.click('finish-delivery');
  assert.equal(d.document.body.dataset.screen, 'chat');
  assert.doesNotMatch(d.app.innerHTML, /class="kanshan-choices"/);
  d.click('back-home');
  d.click('choose', 'iris'); d.click('enter-chat'); d.finish();
  d.click('view', 'B'); d.click('write'); d.click('confirm-consent'); d.click('deposit'); d.tick();
  d.click('continue-public');
  assert.doesNotMatch(d.app.innerHTML, /我想到了家里的客厅|还想补充一点/);
});

test('Noah and Iris share identical chat, discovery markup and own-paper layout', () => {
  const structure = html => [...html.matchAll(/<\/?[a-z][^>]*>/g)].map(([tag]) => tag
    .replace(/src="[^"]*"|alt="[^"]*"/g, '')).join('');
  const scenes = ['xutang', 'iris'].map(id => {
    const d = demo();
    d.click('choose', id);
    const intro = d.app.innerHTML.match(/<div class="login-card">[\s\S]*/)[0];
    d.click('enter-chat'); d.finish();
    const messages = d.app.innerHTML.match(/<div class="kanshan-messages">([\s\S]*?)<div class="kanshan-choices">/)[1];
    const window = d.app.innerHTML.match(/<section class="kanshan-window"[^>]*>/)[0];
    d.click('view', 'B'); d.click('write'); d.click('confirm-consent');
    const paper = d.app.innerHTML.match(/<article class="candidate-overlay-card share-paper-card"[\s\S]*?<\/article>/)[0];
    return [window, structure(intro), structure(messages), structure(paper)];
  });
  assert.deepEqual(scenes[1], scenes[0]);
  assert.match(chatStyles, /--chat-body-size: 14px; --chat-heading-size: 15px; --chat-meta-size: 10px; --chat-quote-size: 13px/);
  assert.doesNotMatch(chatStyles, /public-index-context/);
});

test('closing the original discussion preview returns to chat without reopening the other choice', () => {
  const d = demo();
  d.click('choose', 'iris'); d.click('enter-chat'); d.finish();
  d.click('view', 'B'); d.click('close-public');
  assert.equal(d.document.body.dataset.screen, 'chat');
  assert.match(d.app.innerHTML, /你刚才选择了第二个人/);
  assert.doesNotMatch(d.app.innerHTML, /data-action="view"|纸条已投入信箱|public-response/);
  assert.equal(d.timers.size, 0);
});

test('replay and switching personas cancel pending chat timers', () => {
  const d = demo();
  d.click('choose', 'xutang'); d.click('enter-chat'); d.finish();
  assert.match(d.app.innerHTML, /class="kanshan-choices"/);
  d.click('replay-chat');
  assert.equal(d.timers.size, 1);
  d.click('back-home');
  assert.equal(d.timers.size, 0);
  d.click('choose', 'iris'); d.click('enter-chat');
  assert.match(d.app.innerHTML, /你好，Iris/);
  assert.doesNotMatch(d.app.innerHTML, /没人看见时/);
});

test('Noah can preview the first person without responding, then return and choose Mika', () => {
  const d = demo();
  d.click('choose', 'xutang'); d.click('enter-chat'); d.finish();
  d.click('view', 'A');
  assert.equal(d.document.body.dataset.screen, 'card');
  assert.match(d.app.innerHTML, /id="candidate-name">一个还在写的人/);
  assert.match(d.app.innerHTML, /data-action="write" disabled aria-disabled="true"/);
  assert.match(d.app.innerHTML, /data-action="back" disabled aria-disabled="true">先不回应/);
  d.click('write');
  assert.equal(d.document.body.dataset.screen, 'card');
  d.click('back', undefined, 1);
  assert.equal(d.document.body.dataset.screen, 'card');
  d.click('back');
  assert.equal(d.document.body.dataset.screen, 'chat');
  assert.equal(d.timers.size, 0);
  assert.match(d.app.innerHTML, /class="kanshan-choices"/);
  assert.doesNotMatch(d.app.innerHTML, /class="kanshan-choice-locked"/);
  d.click('view', 'B');
  assert.match(d.app.innerHTML, /id="candidate-name">Mika/);
  d.click('write');
  assert.equal(d.document.body.dataset.screen, 'consent');
});

test('returning from a committed person card does not reopen the other choice', () => {
  const d = demo();
  d.click('choose', 'xutang'); d.click('enter-chat'); d.finish();
  d.click('view', 'B');
  assert.equal(d.document.body.dataset.screen, 'card');
  d.click('back');
  assert.equal(d.document.body.dataset.screen, 'chat');
  assert.doesNotMatch(d.app.innerHTML, /class="kanshan-choices"/);
  assert.doesNotMatch(d.app.innerHTML, /data-action="view"/);
  assert.match(d.app.innerHTML, /你刚才选择了第二个人。这一次相遇已经继续向前了/);
});

test('mailbox consent can return to the selected person without reopening the other choice', () => {
  const d = demo();
  d.click('choose', 'xutang'); d.click('enter-chat'); d.finish();
  d.click('view', 'B'); d.click('write');
  assert.equal(d.document.body.dataset.screen, 'consent');
  d.click('back');
  assert.equal(d.document.body.dataset.screen, 'card');
  assert.match(d.app.innerHTML, /Mika/);
  assert.doesNotMatch(d.app.innerHTML, /data-action="view"/);
});

test('local reference font, texture and stylesheet URLs exist; no CSP exceptions required', () => {
  for (const filename of ['styles.css', 'paper-home.css', 'chat-scene.css']) {
    const css = readFileSync(new URL(filename, root), 'utf8');
    assert.doesNotMatch(css, /data:|https:\/\//);
    for (const [, asset] of css.matchAll(/url\(['"]?\/([^'"\)]+)['"]?\)/g)) assert.ok(existsSync(new URL(asset, root)), asset);
  }
  assert.equal(readFileSync(new URL('paper-assets/paper-sans.woff', root)).subarray(0, 4).toString(), 'wOFF');
  assert.match(readFileSync(new URL('paper-assets/grain.svg', root), 'utf8'), /<svg/);
  assert.equal(readFileSync(new URL('paper-assets/kanshan.png', root)).subarray(1, 4).toString(), 'PNG');
});

test('homepage preserves reference composition and only approved copy changes', () => {
  const reference = readFileSync(new URL('../test-fixtures/前端设计/未见之人_纸绘首页 (1).html', import.meta.url), 'utf8');
  const expectedHome = reference.match(/function home\(\) \{[\s\S]*?\n\}/)[0]
    .replace("const stories = ['等待一句工作的回音', '等待一个看见作品的人'];", "const stories = ['等待一个看见作品的人', '想知道人为什么愿意停留'];")
    .replace('刘看山的另一面', '刘看山说：')
    .replace("${previewAssets['/avatars/liukanshan-muted.png']}", '/paper-assets/kanshan.png')
    .replace('答案已经很多了。', '在知乎，答案和有答案的人已经很多了。')
    .replace('此刻，还有谁', '但是此刻，在知乎，还有谁')
    .replace('<p class="section-index">两个故事 · 一个起点</p>', '')
    .replace('<p>选择一个身份，体验一次相遇。</p>', '');
  assert.equal(script.match(/function home\(\) \{[\s\S]*?\n\}/)[0], expectedHome);
  const referenceStyle = ('/* Homepage study:' + reference.match(/<style>([\s\S]*?)<\/style>/)[1].split('/* Homepage study:')[1])
    .replace(/src: url\('data:[^']+'\)/, "src: url('/paper-assets/paper-sans.woff')")
    .replace(/background: url\('data:[^']+'\)/, "background: url('/paper-assets/grain.svg')");
  const css = readFileSync(new URL('paper-home.css', root), 'utf8');
  assert.ok(css.startsWith(referenceStyle.trimEnd()), 'Original homepage style must remain intact');
  assert.doesNotMatch(css, /max-height: 760px|--mascot-width|flex: 1 0 auto/);
  assert.match(css, /html:has\(body\[data-screen="home"\]\) \{ height: auto; overflow: auto; \}/);
  const assets = JSON.parse(reference.match(/const previewAssets=(\{.*?\});/s)[1]);
  for (const name of ['paper-mika.png', 'paper-noah.png']) {
    assert.deepEqual(readFileSync(new URL(`avatars/${name}`, root)), Buffer.from(assets[`/avatars/${name}`].split(',')[1], 'base64'));
  }
  for (const name of ['paper-iris.png', 'paper-theo.png', 'paper-june.png']) assert.ok(existsSync(new URL(`avatars/${name}`, root)));
});

test('homepage separates the two scenarios and matched people appear later', () => {
  const d = demo();
  assert.match(d.app.innerHTML, /Noah/);
  assert.match(d.app.innerHTML, /Iris/);
  assert.doesNotMatch(d.app.innerHTML, /Mika|Theo|June/);

  d.click('choose', 'xutang'); d.click('enter-chat'); d.finish(); d.click('view', 'B');
  assert.match(d.app.innerHTML, /Mika/);
  assert.match(d.app.innerHTML, /paper-mika\.png/);

  d.click('back'); d.click('back-home'); d.click('choose', 'iris'); d.click('enter-chat'); d.finish();
  d.click('view', 'B');
  assert.match(d.app.innerHTML, /June/);
  assert.match(d.app.innerHTML, /paper-june\.png/);
  assert.match(d.app.innerHTML, /查看改编参考/);
});
