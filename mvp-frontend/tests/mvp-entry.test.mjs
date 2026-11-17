import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEntryController, entryView } from '../public/mvp-entry.js';
import { PRIVATE_MAILBOX_FIXTURES } from '../public/mvp-samples.js';

function harness() {
  let html = '', sequence = 0;
  const timers = new Map();
  const c = createEntryController({
    render: state => { html = entryView(state); },
    schedule: (fn, delay) => { timers.set(++sequence, { fn, delay }); return sequence; },
    cancel: id => timers.delete(id),
  });
  return { c, timers, get html() { return html; },
    finish() {
      for (let i = 0; timers.size && i < 1000; i++) {
        const [id, { fn }] = timers.entries().next().value; timers.delete(id); fn();
      }
      assert.equal(timers.size, 0);
    },
  };
}

test('one click enters the original background layout without requesting auth', () => {
  const h = harness();
  h.c.initialize();
  assert.match(h.html, /data-action="start"/);
  assert.doesNotMatch(h.html, /重新检查登录|不连接登录|data-action="preview"|MVP 建设|Noah|Iris/);
  h.c.action('start');
  assert.equal(h.c.getState().screen, 'login');
  assert.match(h.html, /class="login-card"/);
  assert.match(h.html, /class="login-person"/);
  assert.match(h.html, /class="impression-focus"/);
  assert.match(h.html, />Noah</);
  assert.match(h.html, /avatars\/paper-noah\.png/);
  assert.match(h.html, /资料未同步/);
  assert.doesNotMatch(h.html, /毕业两年|内容运营|退潮信箱|地方志|叙事游戏/);
  assert.doesNotMatch(h.html, /<textarea|复制提示词|格式预览|虚构|先拼起/);
  const bootstrap = readFileSync(new URL('../public/mvp-app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(bootstrap, /fetch\(|readSession\(|window\.location\.assign|allowPreview/);
});

test('fallback stays behind recovery action and saves only user supplied profile', () => {
  const h = harness(); h.c.action('start'); h.c.action('open-profile');
  assert.match(h.html, /<dialog/);
  assert.match(h.html, /复制提示词/);
  h.c.input('nameDraft', '林');
  h.c.input('roleDraft', '晚上写作');
  h.c.input('profileDraft', '【有限背景】\n我在写自己的故事。\n也喜欢声音记录。\n【最近最明显的一条线】\n<script>我不知道是否继续</script>\n【无法确认】\n年龄');
  h.c.action('save-profile');
  assert.doesNotMatch(h.html, /<dialog|<script>|Noah|毕业两年/);
  assert.match(h.html, /林/);
  assert.match(h.html, /我在写自己的故事/);
  assert.match(h.html, /&lt;script&gt;/);
  assert.doesNotMatch(h.html, /无法确认|年龄/);
  assert.match(h.html, /修改背景/);
  h.c.action('enter-chat');
  assert.match(h.html, /样本演示 · Noah/);
  assert.equal(h.c.getState().user.name, '林');
  assert.match(h.html, /class="kanshan-window"/);
  assert.match(h.html, /zh-backdrop/);
  h.c.action('back-home'); h.c.action('start');
  assert.match(h.html, /林/);
  assert.doesNotMatch(h.html, /Noah|退潮信箱/);
});

test('prefilled approved sample reaches every private-path screen without typing', () => {
  const h = harness();
  const ownProfile = structuredClone(h.c.getState().user);
  h.c.action('start'); h.c.action('enter-chat');
  assert.match(h.html, /样本演示 · Noah/);
  assert.match(h.html, /我写了一本几乎没人看的小说/);
  assert.match(h.html, /直接看选项/);
  assert.ok(h.timers.size > 0);
  h.finish();
  assert.match(h.html, /这个话题有点戳到我了，让我先去找找知乎上有没有人聊过类似的经历。/);
  assert.match(h.html, /选择一/); assert.match(h.html, /选择二/);
  h.c.action('view', 'A'); h.c.action('write');
  assert.equal(h.c.getState().screen, 'card');
  h.c.action('back'); assert.equal(h.c.getState().selected, null);
  h.c.action('view', 'B');
  assert.match(h.html, /id="candidate-name">Mika/);
  assert.match(h.html, /非真人/);
  h.c.action('write'); assert.match(h.html, /mailbox-consent-card/);
  h.c.action('confirm-consent');
  assert.match(h.html, /share-paper-card/);
  assert.match(h.html, /退潮信箱/);
  assert.match(h.html, /投入信箱，也递给 Mika/);
  h.c.action('deposit');
  assert.match(h.html, /mailbox-stage/);
  assert.equal([...h.timers.values()][0].delay, 8400);
  h.finish(); assert.match(h.html, /纸条已投入信箱，也已递给 Mika/);
  h.c.action('continue-private');
  assert.match(h.html, /zh-private-window/);
  assert.match(h.html, /退潮信箱/);
  assert.match(h.html, /非真人 · 仅预览交流样式/);
  assert.deepEqual(h.c.getState().user, ownProfile);
});

test('skip sample reveals choices immediately and own input leaves sample cleanly', () => {
  const h = harness(); h.c.action('start'); h.c.action('enter-chat');
  h.c.action('skip-sample');
  assert.equal(h.timers.size, 0);
  assert.match(h.html, /data-action="view" data-id="B"/);
  assert.doesNotMatch(h.html, /直接看选项/);
  h.c.action('replay-chat'); assert.ok(h.timers.size > 0);
  h.c.input('chatDraft', '今天几点了？'); h.c.action('send-chat'); h.finish();
  assert.equal(h.c.getState().sampleScenario, null);
  assert.match(h.html, /Noah/);
  assert.doesNotMatch(h.html, /退潮信箱|毕业两年|内容运营|地方志|叙事游戏|data-action="view"/);
  assert.match(h.html, /今天几点了/);
  h.c.action('back-home'); assert.equal(h.timers.size, 0);
});

test('sample text stays in sync with the approved canonical Noah output', () => {
  const h = harness(); h.c.action('enter-chat');
  const canonical = JSON.parse(readFileSync(new URL('../test-fixtures/MVP/Noah标准输出样本.v0.2.json', import.meta.url), 'utf8'));
  const sample = h.c.getState().sampleScenario;
  assert.deepEqual(sample.chat, canonical.chat);
  assert.deepEqual(sample.discoveryChat, canonical.discoveryChat);
  assert.deepEqual(sample.sharePaper, canonical.sharePaper);
  for (const key of ['A', 'B']) {
    assert.deepEqual(sample.candidates[key], { ...canonical.candidates[key], synthetic: true });
  }
});

test('original selection, card, consent, deposit and private-chat flow uses own input', () => {
  const h = harness(); h.c.action('start'); h.c.action('enter-chat');
  assert.doesNotMatch(h.html, /data-action="view"/);
  h.c.input('chatDraft', '我一直在写小说，没人回应，还要不要继续？');
  h.c.action('send-chat'); h.finish();
  assert.match(h.html, /discovery-start/);
  assert.match(h.html, /discovery-continue/);
  assert.match(h.html, /discovery-focus/);
  assert.match(h.html, /选择一/);
  assert.match(h.html, /选择二/);
  assert.match(h.html, /非真人/);
  assert.doesNotMatch(h.html, /mvp-sample-grid|先让信箱里|看看冷启动/);
  h.c.action('view', 'A');
  h.c.action('write'); assert.equal(h.c.getState().screen, 'card');
  h.c.action('back');
  h.c.action('view', 'B');
  assert.match(h.html, /candidate-overlay-card/);
  h.c.action('write'); assert.match(h.html, /mailbox-consent-card/);
  h.c.action('confirm-consent');
  assert.match(h.html, /share-paper-card/);
  assert.match(h.html, /我一直在写小说，没人回应，还要不要继续？/);
  assert.match(h.html, /Noah/);
  assert.doesNotMatch(h.html, /退潮信箱|毕业两年|内容运营|地方志|叙事游戏/);
  h.c.action('deposit');
  assert.match(h.html, /mailbox-stage/);
  assert.equal([...h.timers.values()][0].delay, 8400);
  h.finish(); assert.match(h.html, /继续和/);
  h.c.action('continue-private');
  assert.match(h.html, /zh-private-window/);
  assert.match(h.html, /private-hint-bubble/);
  h.c.input('privateDraft', '我也会等一句回应。<不是代码>'); h.c.action('send-private');
  assert.match(h.html, /&lt;不是代码&gt;/);
  assert.equal(h.c.getState().privateMessages.length, 1);
});

test('public sample is reachable and returns to discussion after depositing only own paper', () => {
  const h = harness(); h.c.action('start'); h.c.action('enter-chat');
  const ownProfile = structuredClone(h.c.getState().user);
  assert.doesNotMatch(h.html, /查看公域样本|data-action="switch-sample"/);
  h.c.action('switch-sample');
  assert.equal(h.timers.size, 1);
  assert.match(h.html, /样本演示 · Iris/);
  assert.doesNotMatch(h.html, /查看私域样本/);
  const canonical = JSON.parse(readFileSync(new URL('../test-fixtures/MVP/Iris标准输出样本.v0.1.json', import.meta.url), 'utf8'));
  const sample = h.c.getState().sampleScenario;
  assert.deepEqual(sample.chat, canonical.chat);
  assert.deepEqual(sample.discoveryChat, canonical.discoveryChat);
  assert.deepEqual(sample.sharePaper, canonical.sharePaper);
  for (const key of ['A', 'B']) assert.deepEqual(sample.candidates[key], { ...canonical.candidates[key], synthetic: true });
  h.finish(); h.c.action('view', 'B');
  assert.equal(h.c.getState().screen, 'public-preview');
  assert.match(h.html, /zh-public-window/);
  assert.match(h.html, /Demo 文章与评论/);
  assert.doesNotMatch(h.html, /candidate-overlay-card/);
  h.c.action('close-public'); h.c.action('view', 'A');
  assert.equal(h.c.getState().selected, 'B');
  h.c.action('write'); h.c.action('confirm-consent');
  assert.match(h.html, /share-paper-name">Iris/);
  assert.doesNotMatch(h.html, /也递给 June/);
  h.c.action('deposit'); h.finish();
  assert.match(h.html, /回到知乎原文回应/);
  h.c.action('continue-public');
  assert.match(h.html, /id="public-response"/);
  assert.match(h.html, /private-hint-bubble/);
  h.c.input('publicDraft', '这是我的观察。<测试>'); h.c.action('send-public');
  assert.match(h.html, /&lt;测试&gt;/);
  h.c.action('close-public'); h.c.action('finish-delivery'); h.c.action('switch-sample');
  assert.equal(h.c.getState().sampleScenario.name, 'Noah');
  assert.deepEqual(h.c.getState().publicReplies, []);
  assert.deepEqual(h.c.getState().user, ownProfile);
  h.c.action('back-home'); assert.equal(h.timers.size, 0);
});

test('unrelated input does not get assigned fictional matches; leaving cancels animation', () => {
  const h = harness(); h.c.action('start'); h.c.action('enter-chat');
  h.c.input('chatDraft', '今天几点了？'); h.c.action('send-chat'); h.finish();
  assert.doesNotMatch(h.html, /data-action="view"/);
  h.c.input('chatDraft', '我写的小说没人看，还要不要继续？'); h.c.action('send-chat');
  assert.ok(h.timers.size > 0);
  h.c.action('back-home'); assert.equal(h.timers.size, 0);
  assert.equal(h.c.getState().screen, 'home');
});

test('all three approved Demo stylesheets are byte-identical and samples remain data', () => {
  for (const filename of ['styles.css', 'paper-home.css', 'chat-scene.css']) {
    assert.deepEqual(readFileSync(new URL(`../public/${filename}`, import.meta.url)),
      readFileSync(new URL(`../test-fixtures/qiaomen/public/${filename}`, import.meta.url)));
  }
  assert.equal(PRIVATE_MAILBOX_FIXTURES.length, 6);
  assert.ok(PRIVATE_MAILBOX_FIXTURES.every(s => s.synthetic && s.sourceType === 'synthetic_private_sample'));
});
