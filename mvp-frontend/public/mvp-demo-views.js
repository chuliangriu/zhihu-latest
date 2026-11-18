// Renderers lifted from the frozen Demo. Typography, cards and scene layout
// come directly from styles.css, paper-home.css and chat-scene.css.
export function createDemoViews(state, current) {
const esc = (value = '') => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const avatar = (person, size = '') => person?.avatarUrl?.startsWith('https://') ? `<img class="avatar-img ${size}" src="${esc(person.avatarUrl)}" referrerpolicy="no-referrer" alt="${esc(person.name)}"/>` : person?.avatarKey ? `<img class="avatar-img ${size}" src="/avatars/paper-${esc(person.avatarKey)}.png" alt="${esc(person.name)}"/>` : `<span class="avatar-img avatar-placeholder ${size}" aria-hidden="true">○</span>`;
const mailboxIcon = () => `<svg class="mailbox-mini-icon" viewBox="0 0 28 28" aria-hidden="true"><path d="M3.5 12.5a7 7 0 0 1 7-7h6a8 8 0 0 1 8 8v9H3.5z"/><path d="M10.5 5.5a7 7 0 0 1 7 7v10M8 12h6M20 8V3.5h4"/></svg>`;
const messageParts = (message) => message.blocks || (message.paragraphs || [message.text]).map((text) => ({ type: 'paragraph', text }));
const messageLength = (message) => messageParts(message).reduce((total, part) => total + [...part.text].length, 0);
const messageBody = (message, characterLimit = Infinity) => {
  let remaining = characterLimit;
  return messageParts(message).map((part) => {
    if (remaining <= 0) return '';
    const characters = [...part.text];
    const visible = characters.slice(0, remaining).join('');
    remaining -= characters.length;
    if (!visible) return '';
    if (part.type === 'quote') return `<blockquote class="kanshan-found-quote">“${esc(visible)}${visible.length === characters.length ? '”' : ''}</blockquote>`;
    if (part.type === 'paragraph') return `<p>${esc(visible)}</p>`;
    return `<p class="kanshan-found-${esc(part.type)}">${esc(visible)}</p>`;
  }).join('');
};

// Both personas use Noah's approved message layout. Only the text/source varies.
function chatMessage({ message, characterLimit }, index, messages) {
  const continuation = message.role === 'agent' && messages[index - 1]?.message.role === 'agent';
  const discoveryClass = message.discovery ? ` discovery-${message.discovery}` : '';
  const streamingClass = characterLimit !== Infinity ? ' is-streaming' : '';
  return `<div class="kanshan-message ${message.role}${continuation ? ' continuation' : ''}${discoveryClass}${streamingClass}">${message.role === 'agent' && !continuation ? '<span class="kanshan-speaker">看山</span>' : ''}${messageBody(message, characterLimit)}</div>`;
}

function header() {
  const user = current();
  return `<header><button class="brand" data-action="reset">未见之人</button>${user ? `<span class="identity-pill">${avatar(user)}${esc(user.name)}</span>` : ''}${state.live && state.sessionReady && !state.localDevelopment ? '<button class="reset" data-action="logout">退出登录</button>' : ''}${state.screen !== 'home' ? '<button class="reset" data-action="reset">重新开始</button>' : ''}</header>`;
}

function login() {
  const user = current();
  const background = user.impression.slice(0, -1).map((item) => `<p>${esc(item)}</p>`).join('');
  const recentFocus = user.impression.at(-1);
  return `<main class="login-page"><button class="back" data-action="back-home">← 返回首页</button><div class="login-card"><div class="login-person">${avatar(user, 'large')}<div><p class="eyebrow">你的近期背景</p><h1>${esc(user.name)}</h1><p class="login-role">${esc(user.role)}</p></div></div><div class="impression-copy">${background}</div><section class="impression-focus"><span>最近最明显的一条线</span><p>${esc(recentFocus)}</p></section><p class="impression-caveat">这是你目前的有限背景。接下来，可以和刘看山聊聊最近正在想的事。</p><button class="primary login-button" data-action="enter-chat">进入与看山的聊天 <b>→</b></button></div></main>`;
}

function zhihuBackdrop() {
  const topics = ['工作里有哪些让你慢慢想明白的事？', '那些一直坚持的小爱好，后来怎么样了？', '可以分享一个最近被生活打动的瞬间吗？'];
  return `<div class="zh-backdrop" aria-hidden="true" inert>
    <div class="zh-nav"><span class="zh-logo">知乎</span><span>关注</span><strong>推荐</strong><span>热榜</span><span>专栏</span><span>圈子</span><span class="zh-search">搜索你感兴趣的内容 <i>⌕</i></span><span class="zh-ask">＋</span><span>消息</span><span>私信</span></div>
    <div class="zh-feed"><div class="zh-feed-main"><div class="zh-banner"><small>知乎 · 开学季</small><b>新的故事，从一个问题开始。</b><span>记录生活里的好奇心</span></div><div class="zh-publish"><p>分享此刻的想法…</p><div><span>提问题</span><span>写回答</span><span>写文章</span><span>发视频</span></div></div>
    ${topics.map(title => `<article class="zh-article"><h2>${title}</h2><p>每个人都在自己的生活里，留下了一些经历和思考。有些问题还在继续，有些想法值得慢慢说。</p><div class="zh-textline"></div><footer><span>▲ 赞同</span><span>评论</span><span>收藏</span><span>分享</span></footer></article>`).join('')}</div>
    <aside class="zh-sidebar"><section><b>创作中心</b><div class="zh-stats"><span>今日阅读<br><strong>—</strong></span><span>今日新增赞同<br><strong>—</strong></span></div><div class="zh-outline">进入创作中心 ›</div></section><section><b>大家都在搜</b>${['如何找到自己的生活节奏','毕业后的第一份工作','把热爱留在生活里','那些没有说完的话','最近读过什么好书','分享一件小事'].map((s,i) => `<p><em>${i+1}</em>${s}</p>`).join('')}</section><section><b>让每一次表达被看见</b><p>在知乎，分享你的知识、经验和见解。</p></section></aside></div></div>`;
}

function chat(overlayContent = '') {
  const user = current();
  const sequence = [...user.chat, ...(user.discoveryChat || [])];
  const messages = sequence.slice(0, state.stage).map((message) => ({ message, characterLimit: Infinity }));
  if (state.typewriterStage === state.stage && sequence[state.stage]) {
    messages.push({ message: sequence[state.stage], characterLimit: state.typedChars });
  }
  const done = state.stage >= sequence.length;
  const hasChoices = Object.keys(user.candidates).length > 0;
  return `<main class="kanshan-scene ${state.chatOpen ? 'is-open' : 'is-collapsed'}">
    ${zhihuBackdrop()}<div class="zh-haze" aria-hidden="true"></div>
    <div class="scene-tools"><button data-action="back-home">← 返回首页</button><span>${state.sampleScenario ? '样本演示 · ' : ''}${esc(user.name)}</span></div>
    ${state.chatOpen ? `<section class="kanshan-window${overlayContent ? ' is-obscured' : ''}" aria-label="与看山的聊天"${overlayContent ? ' aria-hidden="true" inert' : ''}>
      <div class="kanshan-titlebar"><span class="kanshan-current">${avatar(user)}<span>${esc(user.name)}</span></span><h1>看山</h1><div><button data-action="replay-chat" aria-label="重新播放对话" title="重新播放">↻</button><button data-action="collapse-chat" aria-label="收起聊天窗" title="收起">⌄</button></div></div>
      <div class="kanshan-body" role="log" aria-label="与看山的聊天记录" aria-live="polite">
        <div class="kanshan-greeting"><span class="paper-kanshan" role="img" aria-label="纸绘刘看山"></span><div><h2>你好，${esc(user.name)}</h2><p>今天，有什么想聊聊的？</p></div></div>
        <div class="kanshan-messages">${messages.map(chatMessage).join('')}${!done && state.typewriterStage === null ? '<div class="kanshan-typing">看山正在想<span>···</span></div>' : ''}</div>
        ${state.queuedChat ? `<div class="kanshan-message user"><p>${esc(state.queuedChat)}</p><small class="queued-message-note">已暂存，上一轮处理完后发送</small></div>` : ''}
        ${done && hasChoices && !state.selected ? `<div class="kanshan-choices"><p>你想先听谁说下去？</p><div>${Object.keys(user.candidates).filter(key => key !== 'own').map(key => `<button class="${key === 'B' ? 'choice-primary' : 'choice-muted'}" data-action="view" data-id="${esc(key)}">${key === 'B' ? '第二个人' : '第一个人'}</button>`).join('')}</div></div>` : ''}
        ${done && state.selected && state.selected !== 'own' && !overlayContent ? `<p class="kanshan-choice-locked">你刚才选择了${state.selected === 'B' ? '第二个人' : '第一个人'}。这一次相遇已经继续向前了。</p>` : ''}
      </div>
      <div class="kanshan-composer"><div class="kanshan-input"><textarea id="kanshan-message" aria-label="写下你想说的话" placeholder="畅所欲问" maxlength="2000">${esc(state.chatDraft)}</textarea><button data-action="send-chat" aria-label="发送"${state.chatDraft.trim() ? '' : ' disabled'}>↑</button></div><p>${esc(state.chatNotice)}${state.busy && state.phase ? ' <button class="sample-skip" data-action="cancel-reply">停止等待</button>' : ''}${state.sampleScenario && !done ? ' <button class="sample-skip" data-action="skip-sample">直接看选项 →</button>' : ''}</p></div>
    </section>` : '<div class="kanshan-reopen-hint">点击右下角的看山，继续刚才的对话 ↘</div>'}
    <button class="kanshan-launcher" data-action="toggle-chat" aria-label="${state.chatOpen ? '收起看山' : '打开看山'}" aria-expanded="${state.chatOpen}"${overlayContent ? ' tabindex="-1" aria-hidden="true"' : ''}><img src="/chat-assets/kanshan-official.png" alt=""/></button>
    ${overlayContent}
  </main>`;
}

function candidateOverlay(candidate) {
  const inactive = candidate.previewOnly ? ' disabled aria-disabled="true"' : '';
  const publicSource = candidate.sourceUrl ? `<a class="source-link" href="${esc(candidate.sourceUrl)}" target="_blank" rel="noreferrer">查看知乎原文 ↗</a>` : '';
  const referenceSource = candidate.referenceUrl ? `<a class="source-link" href="${esc(candidate.referenceUrl)}" target="_blank" rel="noreferrer">相关知乎讨论 ↗</a>` : '';
  const isPublic = candidate.sourceType === 'public' || Boolean(candidate.publicReference);
  const publicFooter = isPublic ? `<p class="source candidate-public-source">来自知乎公开表达 ${publicSource}</p>` : '';
  const profileParagraphs = (Array.isArray(candidate.profile) ? candidate.profile : [candidate.profile]).filter(Boolean).slice(0, 2);
  const profile = profileParagraphs.length ? `<div class="candidate-profile">${profileParagraphs.map(text => `<p>${esc(text)}</p>`).join('')}${candidate.focus ? `<section><span>最近最明显的一条线</span><p>${esc(candidate.focus)}</p></section>` : ''}</div>` : '';
  return `<div class="candidate-overlay-layer"><article class="candidate-overlay-card" role="dialog" aria-modal="true" aria-labelledby="candidate-name"><button class="back" data-action="back">← 回到刚才的聊天</button><div class="candidate-head">${avatar(candidate, 'candidate')}<div><p class="eyebrow">你选择继续看见的人</p><h1 id="candidate-name">${esc(candidate.name)}</h1>${state.live && candidate.synthetic ? '<small class="synthetic-label">非真人</small>' : ''}${isPublic ? '' : `<p>${esc(candidate.context)}</p>`}</div></div><blockquote class="quote">“${esc(candidate.quote)}”</blockquote><p class="source">${esc(candidate.time)}${!state.live && candidate.synthetic ? '<small class="synthetic-label">非真人</small>' : ''}${isPublic ? '' : publicSource}${referenceSource}</p>${profile}<div class="connection-copy"><p>${esc(candidate.shared)}</p></div>${publicFooter}<div class="actions">${candidate.contact || (state.live && candidate.synthetic) ? `<button class="primary" data-action="write"${inactive}>回应 TA</button>` : ''}<button class="ghost" data-action="back"${inactive}>先不回应</button></div></article></div>`;
}

function consentOverlay(candidate) {
  if (candidate.publicReference) {
    return `<div class="candidate-overlay-layer mailbox-overlay-layer"><article class="mailbox-consent-card" role="dialog" aria-modal="true" aria-labelledby="mailbox-consent-title"><button class="back" data-action="back">← 回到原讨论</button><p class="mailbox-kicker">${mailboxIcon()}<span>看山们的信箱</span></p><h1 id="mailbox-consent-title">回到知乎回应之前，要不要也留下一张纸？</h1><div class="mailbox-consent-copy"><p>刚才那句话来自知乎的公开讨论。</p><p>如果愿意，你也可以留下关于“${esc(current().sharePaper.subject)}”的纸条，让信箱里的人看见。未来 7 天，看山也会把它带给相关的人；不会公开完整聊天，也可以随时收回。</p></div><button class="primary mailbox-confirm" data-action="confirm-consent">${state.live && state.error ? '重新整理纸条' : '确认'}</button></article></div>`;
  }
  return `<div class="candidate-overlay-layer mailbox-overlay-layer"><article class="mailbox-consent-card" role="dialog" aria-modal="true" aria-labelledby="mailbox-consent-title"><button class="back" data-action="back">← 回到 ${esc(candidate.name)}</button><p class="mailbox-kicker">${mailboxIcon()}<span>看山们的信箱</span></p><h1 id="mailbox-consent-title">在去见 ${esc(candidate.name)} 之前，要不要也留下一张纸？</h1><div class="mailbox-consent-copy"><p>${candidate.synthetic ? '这张纸条里，也有一段尚未说完的近况。' : `你能看见 ${esc(candidate.name)}，是因为他允许这句话在遇到相关的人时被带出来。`}</p><p>如果愿意，你也可以把刚才聊到的事整理成一张纸。未来 7 天，它只会被带给真正相关的人；不会公开完整聊天，也可以随时收回。</p></div><button class="primary mailbox-confirm" data-action="confirm-consent">${state.live && state.error ? '重新整理纸条' : '确认'}</button></article></div>`;
}

function sharePaperOverlay() {
  const user = current();
  const paper = user.sharePaper;
  const candidate = user.candidates[state.selected];
  const recipient = esc(candidate.name);
  const scope = candidate.publicReference ? '纸条可在信箱中浏览；未来 7 天，看山也会把它带给相关的人。不会共享完整聊天，可随时收回。' : '未来 7 天，只在具体关联成立时由对方的看山带回；不会共享完整聊天。';
  return `<div class="candidate-overlay-layer mailbox-overlay-layer"><article class="candidate-overlay-card share-paper-card" role="dialog" aria-modal="true" aria-labelledby="share-paper-name"><button class="back" data-action="back">← 返回授权说明</button><div class="candidate-head">${avatar(user, 'candidate')}<div><p class="eyebrow">准备投入看山们的信箱</p><h1 id="share-paper-name">${esc(user.name)}</h1><p>${esc(paper.context)}</p></div></div><blockquote class="quote">“${esc(paper.quote)}”</blockquote><p class="source">${esc(state.paperOrigin || '由看山根据刚才的对话整理')}</p><div class="candidate-profile"><p>${esc(paper.background)}</p></div><p class="mailbox-scope-line"><span>可发现范围</span>${scope}</p><div class="actions"><button class="primary" data-action="deposit">${candidate.publicReference || (state.live && candidate.synthetic) ? '投入看山们的信箱' : `投入信箱，也递给 ${recipient}`}</button><button class="ghost" data-action="back">再看一遍授权说明</button></div></article></div>`;
}

function depositOverlay() {
  const user = current();
  if (state.live && user.candidates[state.selected].synthetic) {
    return `<div class="candidate-overlay-layer mailbox-overlay-layer"><section class="mailbox-deposit" role="status"><div class="mailbox-stage" aria-hidden="true"><div class="deposit-paper"><span>${esc(user.name.toUpperCase())}</span><i>${esc(user.sharePaper.subject)}</i></div><div class="shared-mailbox"><div class="mailbox-slot"></div><div class="mailbox-box"><span>看山们的信箱</span></div></div><img class="deposit-kanshan" src="/paper-assets/kanshan-letter.png" alt=""/></div><h1>正在把这张纸投入信箱……</h1><p>把刚才的话留下，让相关的人有机会看见。</p></section></div>`;
  }
  return `<div class="candidate-overlay-layer mailbox-overlay-layer"><section class="mailbox-deposit" role="status" aria-live="polite"><div class="mailbox-stage" aria-hidden="true"><div class="deposit-paper"><span>${esc(user.name.toUpperCase())}</span><i>${esc(user.sharePaper.subject)}</i></div><div class="shared-mailbox"><div class="mailbox-slot"></div><div class="mailbox-box"><span>看山们的信箱</span></div></div><img class="deposit-kanshan" src="/paper-assets/kanshan-letter.png" alt=""/></div><h1>正在把这张纸投入信箱……</h1><p>${user.candidates[state.selected].publicReference ? '把这份好奇留下，让相关的人有机会看见。' : `也在把它递给 ${esc(user.candidates[state.selected].name)}。`}</p></section></div>`;
}

function deliveredOverlay(candidate) {
  if (state.live && candidate.synthetic) {
    return `<div class="candidate-overlay-layer mailbox-overlay-layer"><section class="mailbox-deposit mailbox-delivered" role="dialog" aria-modal="true" aria-labelledby="delivery-title">${mailboxIcon()}<h1 id="delivery-title">纸条已投入信箱。</h1><p>你可以停在这里，也可以继续看看。</p><button class="primary" data-action="continue-private">继续和 ${esc(candidate.name)} 聊聊</button><button class="text-btn" data-action="finish-delivery">不聊了</button><small class="synthetic-label">对方为非真人，后续交流仅作预览。</small></section></div>`;
  }
  if (candidate.publicReference) {
    return `<div class="candidate-overlay-layer mailbox-overlay-layer"><section class="mailbox-deposit mailbox-delivered" role="dialog" aria-modal="true" aria-labelledby="delivery-title">${mailboxIcon()}<h1 id="delivery-title">纸条已投入信箱。</h1><p>这份好奇可以被更多相关的人看见。<br/>现在，要不要回到知乎，把话接下去？</p><button class="primary" data-action="continue-public">回到知乎原文回应</button><button class="text-btn" data-action="finish-delivery">先不回应</button></section></div>`;
  }
  return `<div class="candidate-overlay-layer mailbox-overlay-layer"><section class="mailbox-deposit mailbox-delivered" role="dialog" aria-modal="true" aria-labelledby="delivery-title">${mailboxIcon()}<h1 id="delivery-title">纸条已投入信箱，也已递给 ${esc(candidate.name)}。</h1><p>你可以停在这里，也可以再聊几句。</p><button class="primary" data-action="continue-private">继续和 ${esc(candidate.name)} 聊聊</button><button class="text-btn" data-action="finish-delivery">不聊了</button></section></div>`;
}

function privateChat(candidate) {
  const user = current();
  return `<main class="kanshan-scene zh-private-scene">${zhihuBackdrop()}<div class="zh-haze" aria-hidden="true"></div><div class="zh-private-shade" aria-hidden="true"></div>
    <section class="zh-private-window" role="dialog" aria-modal="true" aria-labelledby="private-title">
      <header class="zh-private-title"><h1 id="private-title">${esc(candidate.name)}</h1><button data-action="close-private" aria-label="关闭私信">×</button></header>
      <div class="zh-private-history" role="log" aria-label="与 ${esc(candidate.name)} 的聊天记录" aria-live="polite">
        <p class="zh-private-notice${candidate.synthetic ? ' synthetic-label' : ''}">${candidate.synthetic ? '非真人 · 仅预览交流样式，未实际发送' : '纸条已递出，等待对方回应'}</p>
        <div class="zh-private-row"><article class="zh-private-paper"><span>来自看山们的信箱</span><h2>${esc(user.name)}</h2><small>${esc(user.sharePaper.context)}</small><blockquote>“${esc(user.sharePaper.quote)}”</blockquote><p>${esc(user.sharePaper.background)}</p></article>${avatar(user)}</div>
        ${state.privateMessages.map(message => `<div class="zh-private-row"><p class="zh-private-bubble">${esc(message)}</p>${avatar(user)}</div>`).join('')}
      </div>
      <div class="zh-private-composer">
        <div class="zh-private-tools" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 14c2 3 6 3 8 0M8 9h.1M16 9h.1"/></svg><svg viewBox="0 0 24 24"><path d="M13 20H4V4h16v9M4 17l5-5 4 4 3-3M19 16v6M16 19h6"/><circle cx="9" cy="8" r="1.5"/></svg></div>
        <div class="zh-private-entry">
          <textarea id="private-message" aria-label="写下你想对 ${esc(candidate.name)} 说的话" aria-describedby="private-guidance" placeholder="想接着对 ${esc(candidate.name)} 说些什么？">${esc(state.privateDraft)}</textarea>
          <aside class="private-compose-hint" aria-label="写消息提示"><span class="private-hint-kanshan" role="img" aria-label="侧身指向前方的纸绘刘看山"></span><div class="private-hint-bubble" id="private-guidance"><strong>现在轮到你了。</strong><p>写一句只想让 ${esc(candidate.name)} 看见的话。他可以接受，也可以不回应。</p></div></aside>
        </div>
        <div class="zh-private-sendbar"><span>${state.live && candidate.synthetic ? '内容只在本页预览，不会实际发送。' : '仅当前页面保存 · Enter 发送'}</span><button data-action="send-private"${state.privateDraft.trim() ? '' : ' disabled'}>发送</button></div>
      </div>
    </section></main>`;
}

function publicDiscussion(candidate, preview = false) {
  const user = current();
  const source = candidate.publicReference;
  return `<main class="kanshan-scene zh-private-scene">${zhihuBackdrop()}<div class="zh-haze" aria-hidden="true"></div><div class="zh-private-shade" aria-hidden="true"></div>
    <section class="zh-private-window zh-public-window" role="dialog" aria-modal="true" aria-labelledby="public-title">
      <header class="zh-private-title"><h1 id="public-title">${preview ? '知乎里的这段讨论' : '回到知乎的这段讨论'}</h1><button data-action="close-public" aria-label="${preview ? '回到刚才的聊天' : '关闭讨论'}">×</button></header>
      <div class="zh-public-history" aria-label="知乎回答与评论片段">
        <article class="zh-public-answer"><div class="zh-public-source"><span>${esc(source.contentLabel)}</span><a href="${esc(source.url)}" target="_blank" rel="noreferrer">${esc(source.linkLabel)}</a></div><h2>${esc(source.title)}</h2><p>${esc(source.contextSummary)}</p><small>Demo 文章与评论 · 由知乎公开讨论改编</small></article>
        <section class="zh-public-comments" aria-label="评论区"><h3>评论 · 按互动排序</h3><p class="zh-public-visibility">${esc(source.visibilityNote)}</p><article class="zh-public-comment">${avatar(candidate)}<div><strong>${esc(candidate.name)}</strong><p>${esc(candidate.quote)}</p><span>${esc(candidate.time)}</span><div class="zh-public-actions" aria-label="这条评论的互动数据"><span><b>▲</b> 赞同 ${source.metrics.upvotes}</span><span>▼ 反对 ${source.metrics.downvotes}</span><span>回复 ${source.metrics.replies}</span></div></div></article>
          <div class="zh-public-replies" role="log" aria-live="polite">${state.publicReplies.map(message => `<article class="zh-public-comment">${avatar(user)}<div><strong>${esc(user.name)} <small>回复 ${esc(candidate.name)}</small></strong><p>${esc(message)}</p><span>刚刚 · 演示回应，仅当前页面可见</span></div></article>`).join('')}</div>
        </section>
      </div>
      ${preview ? `<div class="zh-public-preview-actions"><button data-action="write">回应这条表达</button><button data-action="close-public">回到刚才的聊天</button></div>` : `<div class="zh-private-composer zh-public-composer"><p class="zh-public-reply-label">回复 ${esc(candidate.name)}</p><div class="zh-private-entry">
        <textarea id="public-response" aria-label="回复 ${esc(candidate.name)} 的评论" aria-describedby="public-guidance" placeholder="把你的观察接在这条评论下面……">${esc(state.publicDraft)}</textarea>
        <aside class="private-compose-hint" aria-label="回应提示"><span class="private-hint-kanshan" role="img" aria-label="侧身指向前方的纸绘刘看山"></span><div class="private-hint-bubble" id="public-guidance"><strong>现在轮到你了。</strong><p>把你的观察留在这条评论下面，让 ${esc(candidate.name)}，也让路过的人看见。</p></div></aside>
      </div><div class="zh-private-sendbar"><span>Demo 评论预览 · Enter 发布</span><button data-action="send-public"${state.publicDraft.trim() ? '' : ' disabled'}>发布</button></div></div>`}
    </section></main>`;
}


return { header, login, chat, candidateOverlay, consentOverlay, sharePaperOverlay, depositOverlay, deliveredOverlay, privateChat, publicDiscussion, messageLength, mailboxIcon };
}
