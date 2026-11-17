import { createDemoViews } from './mvp-demo-views.js';
import { initialUser, parseProfile, KANSHAN_PROFILE_PROMPT } from './mvp-profile.js';
import { localChatTurn } from './mvp-local-flow.js';
import { createChatSample } from './mvp-chat-sample.js';
import { createPublicChatSample } from './mvp-public-sample.js';
export { KANSHAN_PROFILE_PROMPT } from './mvp-profile.js';

export const SCENE_SCREENS = ['chat', 'card', 'consent', 'share', 'deposit', 'delivered', 'private', 'public-preview', 'public'];
const esc = (value = '') => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const flowUser = state => state.sampleScenario || state.user;
const viewUser = state => {
  const user = SCENE_SCREENS.includes(state.screen) ? flowUser(state) : state.user;
  return { ...user, impression: [...user.impression, user.recentFocus] };
};

export function createEntryController({ render, schedule = setTimeout, cancel = clearTimeout }) {
  const state = {
    screen: 'home', user: initialUser(), sampleScenario: null, stage: 0, selected: null,
    chatOpen: true, typewriterStage: null, typedChars: 0, timer: null,
    chatDraft: '', privateDraft: '', privateMessages: [], publicDraft: '', publicReplies: [],
    chatNotice: '内容仅保留在当前页面', paperOrigin: '来自你刚才确认的背景与表达',
    profileOpen: false, profileDraft: '', nameDraft: '', roleDraft: '', profileError: '',
    homeExampleOpen: false, homeExampleTrigger: 'writer',
  };
  const paint = () => render(state);
  const stop = () => { cancel(state.timer); state.timer = null; };
  function play() {
    stop(); paint();
    const user = flowUser(state);
    const sequence = [...user.chat, ...user.discoveryChat];
    if (state.screen !== 'chat' || !state.chatOpen || state.stage >= sequence.length) return;
    const message = sequence[state.stage];
    if (state.typewriterStage === state.stage) {
      const total = createDemoViews(state, () => viewUser(state)).messageLength(message);
      state.timer = schedule(() => {
        state.typedChars = Math.min(total, state.typedChars + 6);
        if (state.typedChars >= total) { state.stage++; state.typewriterStage = null; state.typedChars = 0; }
        play();
      }, 38);
    } else {
      state.timer = schedule(() => {
        if (message.typewriter) { state.typewriterStage = state.stage; state.typedChars = 0; }
        else state.stage++;
        play();
      }, message.delay || 1300);
    }
  }
  const candidate = () => flowUser(state).candidates[state.selected];
  function sendChat() {
    const text = state.chatDraft.trim().slice(0, 2000);
    if (!text) return;
    if (state.sampleScenario) {
      stop(); state.sampleScenario = null;
      state.stage = state.user.chat.length + state.user.discoveryChat.length;
      state.typewriterStage = null; state.typedChars = 0;
      state.paperOrigin = '来自你刚才确认的背景与表达';
    }
    const total = state.user.chat.length + state.user.discoveryChat.length;
    if (!text || state.stage < total) return;
    const turn = localChatTurn(text);
    const previous = [...state.user.chat, ...state.user.discoveryChat];
    state.user.chat = [...previous, ...turn.messages];
    state.user.discoveryChat = turn.discovery;
    state.user.candidates = turn.candidates;
    state.selected = null;
    state.privateDraft = ''; state.privateMessages = [];
    state.user.sharePaper = {
      subject: '刚才说的这件事', quote: text, context: state.user.role,
      background: state.user.profileReady ? [...state.user.impression, state.user.recentFocus].join('\n\n') : '',
    };
    state.stage = previous.length + 1;
    state.chatDraft = '';
    state.chatNotice = turn.discovery.length ? '非真人样本 · 话术与投递为本地预览' : '已留在当前页面，回复待聊天服务接入';
    play();
  }
  function action(action, id) {
    if (action === 'open-home-example' && state.screen === 'home') {
      state.homeExampleTrigger = ['writer', 'researcher', 'hint'].includes(id) ? id : 'writer';
      state.homeExampleOpen = true; paint(); return;
    }
    if (action === 'close-home-example') { state.homeExampleOpen = false; paint(); return; }
    if (action === 'switch-sample' && state.screen === 'chat' && state.sampleScenario) {
      stop();
      state.sampleScenario = state.sampleScenario.id === 'sample-noah' ? createPublicChatSample() : createChatSample();
      state.stage = 1; state.selected = null; state.typewriterStage = null; state.typedChars = 0;
      state.chatDraft = ''; state.privateDraft = ''; state.privateMessages = [];
      state.publicDraft = ''; state.publicReplies = [];
      state.paperOrigin = `样本纸条 · 来自 ${state.sampleScenario.name} 的预设对话`;
      state.chatNotice = `样本演示 · ${state.sampleScenario.name} · 对话、匹配与投递均为预设`;
      state.chatOpen = true; play(); return;
    }
    if (action === 'start') { state.homeExampleOpen = false; state.screen = 'login'; paint(); return; }
    if (action === 'open-profile') { state.profileOpen = true; paint(); return; }
    if (action === 'close-profile') { state.profileOpen = false; state.profileError = ''; paint(); return; }
    if (action === 'save-profile') {
      const profile = parseProfile(state.profileDraft, state.nameDraft, state.roleDraft);
      if (!profile.profileReady) { state.profileError = '先粘贴一段背景，再保存。'; paint(); return; }
      Object.assign(state.user, profile);
      state.profileOpen = false; state.profileError = ''; paint(); return;
    }
    if (action === 'enter-chat') {
      if (!state.sampleScenario && state.user.chat.length === 0) {
        state.sampleScenario = createChatSample();
        state.stage = 1; state.selected = null; state.typewriterStage = null; state.typedChars = 0;
        state.chatNotice = '样本演示 · Noah 与 Mika · 对话、匹配与投递均为预设';
        state.paperOrigin = '样本纸条 · 来自 Noah 的预设对话';
      }
      state.screen = 'chat'; state.chatOpen = true; play(); return;
    }
    if (action === 'skip-sample' && state.sampleScenario && state.screen === 'chat') {
      stop(); state.stage = state.sampleScenario.chat.length + state.sampleScenario.discoveryChat.length;
      state.typewriterStage = null; state.typedChars = 0; paint(); return;
    }
    if (action === 'send-chat') { sendChat(); return; }
    if (action === 'replay-chat') { state.stage = 0; state.typewriterStage = null; play(); return; }
    if (action === 'collapse-chat' || action === 'toggle-chat') { state.chatOpen = action === 'collapse-chat' ? false : !state.chatOpen; play(); return; }
    if (action === 'view' && !state.selected && flowUser(state).candidates[id]) {
      state.selected = id; state.screen = candidate().publicReference ? 'public-preview' : 'card'; paint(); return;
    }
    if (action === 'write' && candidate() && !candidate().previewOnly) { state.screen = 'consent'; paint(); return; }
    if (action === 'confirm-consent') { state.screen = 'share'; paint(); return; }
    if (action === 'deposit' && state.screen === 'share') {
      state.screen = 'deposit'; paint(); stop();
      state.timer = schedule(() => { state.timer = null; state.screen = 'delivered'; paint(); }, 8400);
      return;
    }
    if (action === 'continue-private' && state.screen === 'delivered') { state.screen = 'private'; paint(); return; }
    if (action === 'continue-public' && state.screen === 'delivered') { state.screen = 'public'; paint(); return; }
    if (action === 'close-private') { state.screen = 'delivered'; paint(); return; }
    if (action === 'close-public') { state.screen = state.screen === 'public-preview' ? 'chat' : 'delivered'; paint(); return; }
    if (action === 'send-private' && state.privateDraft.trim()) { state.privateMessages.push(state.privateDraft.trim()); state.privateDraft = ''; paint(); return; }
    if (action === 'send-public' && state.publicDraft.trim()) { state.publicReplies.push(state.publicDraft.trim()); state.publicDraft = ''; paint(); return; }
    if (action === 'finish-delivery') { state.screen = 'chat'; paint(); return; }
    if (action === 'back') {
      stop();
      if (state.screen === 'share') state.screen = 'consent';
      else if (state.screen === 'consent') state.screen = candidate().publicReference ? 'public-preview' : 'card';
      else { if (candidate()?.previewOnly) state.selected = null; state.screen = 'chat'; }
      paint(); return;
    }
    if (['back-home', 'reset'].includes(action)) { stop(); state.screen = 'home'; state.profileOpen = false; state.homeExampleOpen = false; paint(); }
  }
  return {
    initialize: paint, action, getState: () => state, resume: play, stop,
    input(field, value) {
      if (['profileDraft', 'nameDraft', 'roleDraft', 'chatDraft', 'privateDraft', 'publicDraft'].includes(field)) state[field] = value;
    },
  };
}

function home(state) {
  return `<main class="home paper-home"><section class="paper-hero" aria-labelledby="home-title">
    <div class="hero-copy">
      <p class="paper-kicker"><span aria-hidden="true">✳</span> 看山们的信箱</p>
      <p class="hero-prelude">有些答案，写于事情过去之后。</p>
      <h1 id="home-title">但此刻，在知乎，还有谁，<br/><span>也正在经历与你相似的事？</span></h1>
      <p class="hero-description">和看山聊聊最近的近况，找到同样身在其中的人。<br/>你们可能生活不同，却正面对相通的犹豫、选择或期待。</p>
      <button class="explore-link mvp-chat-entry" data-action="start">和看山聊聊 <span aria-hidden="true">↗</span></button>
      <aside class="home-mailbox" aria-label="看山们的信箱与相遇示例">
        <div class="mailbox-scene">
          <button id="home-paper-writer" class="mailbox-slip mailbox-slip-writer" data-action="open-home-example" data-id="writer" aria-haspopup="dialog" aria-controls="home-example" aria-expanded="${state.homeExampleOpen ? 'true' : 'false'}" aria-label="打开相遇示例：正在写小说的 TA"><span>正在写小说<br/>的 TA</span><span class="slip-lines" aria-hidden="true"></span></button>
          <button id="home-paper-researcher" class="mailbox-slip mailbox-slip-researcher" data-action="open-home-example" data-id="researcher" aria-haspopup="dialog" aria-controls="home-example" aria-expanded="${state.homeExampleOpen ? 'true' : 'false'}" aria-label="打开相遇示例：正在做研究的 TA"><span>正在做研究<br/>的 TA</span><span class="slip-lines" aria-hidden="true"></span></button>
          <img class="home-mailbox-illustration" src="/paper-assets/home-mailbox.png" width="282" height="191" alt="看山们的信箱"/>
        </div>
        <div class="mailbox-copy"><h2>把正在经历的事，<br/>写给也在经历的人。</h2><p>留下一张经你确认的纸条，读读另一个人此刻的近况。如果愿意，就给彼此回信。</p><button class="mailbox-example-link" data-action="open-home-example" data-id="hint" id="home-paper-hint" aria-haspopup="dialog" aria-controls="home-example">点开纸条，看看他们为什么会相遇 <span aria-hidden="true">↗</span></button></div>
      </aside>
    </div>
    <div class="hero-illustration">
      <div class="mascot-window" role="img" aria-label="戴着灰蓝围巾的白色刘看山，轻轻招手"><img src="/paper-assets/kanshan.png" alt=""/></div>
      <span class="mascot-caption">我帮你发现。接下来，交给你们。</span>
    </div>
  </section>
  <section class="home-how" aria-labelledby="home-how-title">
    <h2 id="home-how-title">这个信箱是做什么的？</h2>
    <ol><li><span class="home-step-number" aria-hidden="true">01</span><h3>聊聊你的近况</h3><p>说说最近让你投入、犹豫或反复思考的事。</p></li>
      <li><span class="home-step-number" aria-hidden="true">02</span><h3>留下一张纸条</h3><p>看山帮你整理，你修改并确认后放进信箱，也可以收回。</p></li>
      <li><span class="home-step-number" aria-hidden="true">03</span><h3>读信，也给对方回信</h3><p>读读相关的人留下的纸条，选择递去自己的近况，让对方决定是否回信。</p></li></ol>
  </section>
  <footer class="home-footer"><p>生活不同，也可能在同一处停留。</p></footer></main>${state.homeExampleOpen ? homeExample() : ''}`;
}

function homeExample() {
  return `<dialog id="home-example" class="home-example-dialog" aria-labelledby="home-example-title" aria-describedby="home-example-connection">
    <div class="home-example-content">
      <div class="home-example-topline"><span class="home-example-label">相遇示例 · 虚构纸条</span><button class="home-example-close" data-action="close-home-example" aria-label="关闭相遇示例" autofocus>×</button></div>
      <h2 id="home-example-title">什么样的两个人，<br/>可能在这里相遇？</h2>
      <div class="example-letters">
        <article class="example-letter example-letter-writer"><p class="letter-person">正在写小说的 TA</p><blockquote>小说还在写，但迟迟没有读者反馈。我有点不知道，该继续写下去，还是换个方向。</blockquote><span class="letter-note">写作还在继续</span></article>
        <article class="example-letter example-letter-researcher"><p class="letter-person">正在做研究的 TA</p><blockquote>研究还在做，但很久看不到明确成果。我也拿不准，是再坚持一下，还是调整方向。</blockquote><span class="letter-note">研究还在进行</span></article>
      </div>
      <p id="home-example-connection" class="home-example-connection">生活不同，却都在想：<strong>没有回声的时候，怎么判断还要不要继续？</strong></p>
      <p class="home-example-footnote">两个人都还在经历。他们可以从一张纸条开始，交换各自此刻的近况。</p>
      <button class="home-example-done" data-action="close-home-example">收好纸条 <span aria-hidden="true">↙</span></button>
    </div>
  </dialog>`;
}

function profileImport(state) {
  return `<dialog class="profile-import-dialog" aria-labelledby="profile-import-title"><div class="login-card">
    <button class="back" data-action="close-profile">← 返回人物背景</button><h1 id="profile-import-title">补充你的近期背景</h1>
    <p>复制提示词发给刘看山，再把整理结果粘贴回来。</p>
    <details><summary>查看提示词</summary><pre>${esc(KANSHAN_PROFILE_PROMPT)}</pre></details>
    <div class="actions"><button class="ghost" data-action="copy-profile-prompt">复制提示词</button><a href="https://www.zhihu.com/" target="_blank" rel="noopener noreferrer">打开知乎 ↗</a></div>
    <label>昵称<input data-field="nameDraft" maxlength="40" value="${esc(state.nameDraft)}" placeholder="怎么称呼你"/></label>
    <label>一句背景<input data-field="roleDraft" maxlength="80" value="${esc(state.roleDraft)}" placeholder="只写你愿意介绍的部分"/></label>
    <label>刘看山整理的内容<textarea data-field="profileDraft" maxlength="1600" rows="7" placeholder="粘贴后可以删改……">${esc(state.profileDraft)}</textarea></label>
    <p class="impression-caveat">只保留你愿意带入的内容。这不会自动投入信箱。</p>
    <p role="status">${esc(state.profileError)}</p><button class="primary" data-action="save-profile">保存到我的背景</button>
  </div></dialog>`;
}

function renderEntry(state) {
  const views = createDemoViews(state, () => viewUser(state));
  if (state.screen === 'home') return `<header><button class="brand" data-action="reset">未见之人</button></header>${home(state)}`;
  if (state.screen === 'login') return views.header() + views.login() + `<button class="profile-recovery" data-action="open-profile">${state.user.profileReady ? '修改背景' : '资料未同步'}</button>` + (state.profileOpen ? profileImport(state) : '');
  const selected = flowUser(state).candidates[state.selected];
  if (state.screen === 'chat') return views.chat();
  const overlay = { card: () => views.candidateOverlay(selected), consent: () => views.consentOverlay(selected), share: views.sharePaperOverlay,
    deposit: views.depositOverlay, delivered: () => views.deliveredOverlay(selected) }[state.screen];
  if (overlay) return views.chat(overlay());
  if (state.screen === 'private') return views.privateChat(selected);
  if (state.screen === 'public-preview' || state.screen === 'public') return views.publicDiscussion(selected, state.screen === 'public-preview');
  return '';
}

export function entryView(state) {
  let html = renderEntry(state);
  if (!state.live) return html;
  if (state.paperEdit) html += `<dialog class="profile-import-dialog" aria-label="修改纸条"><div class="login-card"><h1>修改这张纸</h1>${[['subject','主题',24],['quote','想留下的话',100],['context','简短背景',30],['background','人物介绍',160]].map(([key,label,limit]) => `<label>${label}<textarea data-field="paper-${key}" maxlength="${limit}">${esc(state.paperEdit[key])}</textarea></label>`).join('')}<button data-action="save-paper-edit">保存修改</button><button data-action="cancel-paper-edit">取消</button></div></dialog>`;
  html = html.replace('Demo 文章与评论 · 由知乎公开讨论改编', '来自知乎公开表达，完整语境见原文')
    .replace('评论 · 按互动排序', '原文片段')
    .replace('仅当前页面保存 · Enter 发送', '点击后前往知乎继续联系，文字不会自动发送。')
    .replace('Demo 评论预览 · Enter 发布', '点击后前往知乎原文，文字不会自动发布。');
  if (state.error) html += `<div class="mvp-live-status" role="alert">${esc(state.error)}</div>`;
  else if (state.busy && state.screen !== 'chat') html += '<div class="mvp-live-status" role="status">正在处理……</div>';
  if (state.activePapers?.length && state.screen === 'chat' && !state.busy) html += `<div class="mvp-paper-tools">${state.activePapers.map(p => `<button data-action="withdraw-paper" data-id="${esc(p.id)}">收回${p.subject ? `「${esc(p.subject)}」` : '我的纸条'}</button>`).join('')}</div>`;
  if (state.screen === 'share' && !state.busy) html += '<div class="mvp-paper-tools"><button data-action="edit-paper">修改这张纸</button></div>';
  return html;
}
