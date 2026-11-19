const esc = (value = '') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time = value => value ? new Date(value).toLocaleString('zh-CN', {hour12:false}) : '';
const status = value => ({draft:'未投入的草稿',active:'已留下',expired:'已停止新匹配',withdrawn:'已撤回'}[value] || '');
const wrap = (title, body, back = 'close-mailbox') => `<div class="candidate-overlay-layer"><section class="candidate-overlay-card mailbox-panel" role="dialog" aria-modal="true" aria-label="${esc(title)}"><button class="back" data-action="${back}">← 回到刚才的聊天</button><h1>${esc(title)}</h1>${body}</section></div>`;

export function mailboxView(state) {
  const box = state.mailbox;
  if (!box) return wrap('我的纸条与交流', state.busy ? '<p role="status">正在读取历史……</p>' : '<p>这次未能读取历史，请稍后重试。</p><button class="ghost" data-action="refresh-mailbox">重新读取历史</button>');
  return wrap('我的纸条与交流', `<button class="ghost" data-action="refresh-mailbox">刷新</button>
    <h2>我的纸条</h2>${box.papers.length ? box.papers.map(p => `<article class="mailbox-history-row"><button data-action="open-paper" data-id="${esc(p.id)}">${esc(p.subject)}</button><small>${status(p.status)} · ${esc(time(p.confirmedAt || p.createdAt))}${p.matchingAllowed === false ? ' · 不参与新匹配' : ''}</small>${['active','expired'].includes(p.status) ? `<button class="text-btn" data-action="withdraw-paper" data-id="${esc(p.id)}">收回</button>` : ''}</article>`).join('') : '<p>你还没有留下纸条。没有匹配，也可以留下一张。</p>'}
    <h2>围绕纸条的交流</h2>${box.discussions.length ? box.discussions.map(t => `<article class="mailbox-history-row"><button data-action="open-discussion" data-id="${esc(t.id)}">${esc(t.paper.subject)}</button><small>${esc(time(t.updatedAt))}${t.canReply ? '' : ' · 已停止新回复'}</small></article>`).join('') : '<p>还没有交流。有人回应你的纸条后，会出现在这里。</p>'}
    <h2>与看山的对话</h2>${box.conversations.length ? box.conversations.map(c => `<article class="mailbox-history-row"><button data-action="restore-conversation" data-id="${esc(c.id)}">继续 ${esc(time(c.createdAt))} 的对话</button></article>`).join('') : '<p>还没有保存的对话。</p>'}
    <p class="source">显示最近 50 张纸条、50 段交流和 30 段与看山的对话。</p>`);
}

export function discussionView(state) {
  const t = state.discussion;
  if (!t) return wrap('纸条里的交流', '<p>正在读取交流……</p>', 'close-discussion');
  const paper = p => `<article class="mailbox-thread-paper"><small>${p.own ? '你的纸条' : `${esc(p.displayName)} 的纸条`}${p.status === 'expired' ? ' · 已停止新匹配' : ''}</small><h2>${esc(p.subject)}</h2>${p.status === 'withdrawn' ? '<p>这张纸条已撤回，正文不再展示。</p>' : `<blockquote>“${esc(p.quote)}”</blockquote><p>${esc(p.background)}</p>`}</article>`;
  return wrap('纸条里的交流', `<button class="ghost" data-action="refresh-discussion">刷新交流</button>${paper(t.paper)}${paper(t.introduction)}
    <section class="mailbox-replies" role="log" aria-live="polite" aria-label="当前讨论的回复">${t.messages.length ? t.messages.map(m => `<article class="mailbox-reply${m.own ? ' own' : ''}"><small>${m.own ? '你' : '对方'} · ${esc(time(m.createdAt))}</small><p>${esc(m.content)}</p></article>`).join('') : '<p>还没有回复，可以从一句话开始。</p>'}</section>
    ${t.canReply ? `<label for="discussion-message">接着说几句</label><textarea id="discussion-message" maxlength="2000" rows="3" placeholder="只在这段讨论里交流……">${esc(state.replyDraft)}</textarea><button class="primary" data-action="send-discussion"${state.replyDraft.trim() ? '' : ' disabled'}>发送回复</button>` : `<p role="status">${t.closedReason === 'paper_withdrawn' ? '有纸条已撤回，这段讨论停止新回复，已有回复仍保留。' : '这段讨论暂不接受新回复。'}</p>`}`, 'close-discussion');
}

export function ownPaperView(state) {
  const p = state.paper;
  if (!p) return wrap('我的纸条', '<p>暂时无法读取纸条。</p>');
  return wrap('我的纸条', `<p class="source">${status(p.status)}</p><h2>${esc(p.subject)}</h2><blockquote>“${esc(p.quote)}”</blockquote><p>${esc(p.background)}</p>${p.status === 'draft' ? '<button class="primary" data-action="resume-paper">继续编辑并确认</button>' : ''}${['active','expired'].includes(p.status) ? `<button class="ghost" data-action="withdraw-paper" data-id="${esc(p.id)}">收回这张纸条</button>` : ''}`);
}

export function livePaperOverlay(state) {
  const c = state.user.candidates[state.selected];
  if (state.screen === 'consent') return wrap('留下一张自己的纸条', `<p>${c ? '回应之前，先留下你愿意分享的这段话。' : '没有匹配，也可以把刚才聊到的事留在信箱。'}</p><p>看山会整理草稿，由你修改、选择范围并确认。完整聊天不会共享。</p><button class="primary" data-action="confirm-consent">${state.error ? '重新整理纸条' : '整理纸条草稿'}</button>`, 'back');
  if (state.screen === 'share') {
    const p = state.paper, o = state.paperOptions;
    return wrap('确认这张纸条', `<h2>${esc(p.subject)}</h2><blockquote>“${esc(p.quote)}”</blockquote><p>${esc(p.context)}</p><p>${esc(p.background)}</p>
      <fieldset class="mailbox-choices"><legend>由你决定分享范围</legend>
        <label><input type="checkbox" data-field="matchingAllowed"${o.matchingAllowed ? ' checked' : ''}/> 未来 7 天，允许看山把这张纸条带给相关的人</label>
        <label>对方看到的称呼 <select data-field="identityDisclosure"><option value="anonymous"${o.identityDisclosure === 'anonymous' ? ' selected' : ''}>匿名</option><option value="nickname"${o.identityDisclosure === 'nickname' ? ' selected' : ''}>我的知乎昵称</option></select></label>
        <label><input type="checkbox" data-field="contactAllowed"${o.contactAllowed ? ' checked' : ''}/> 允许围绕这张纸条交流</label>
      </fieldset><p class="source">只有你和实际匹配到它的人可以阅读；可随时撤回。到期后停止新匹配，已有交流继续。</p>${c?.sourceType === 'authorized_private' && !o.contactAllowed ? '<p>关闭交流后仍可保存自己的纸条，但不会递给当前对象。</p>' : ''}
      <div class="actions"><button class="primary" data-action="deposit">确认并留下纸条</button><button class="ghost" data-action="edit-paper">修改文字</button></div>`, 'back');
  }
  if (state.screen === 'deposit') return wrap('纸条已保存', '<p role="status">正在收好这张纸条……</p>', 'finish-delivery');
  if (state.screen === 'delivered') {
    const real = c?.sourceType === 'authorized_private' && state.delivery;
    return wrap('纸条已留下', `<p>${state.paperOptions.matchingAllowed ? '未来 7 天，相关的人有机会读到它。' : '这张纸条不会参与新的匹配。'}</p>${real ? '<button class="primary" data-action="continue-private">打开这段交流</button>' : c?.sourceType === 'public' ? '<p>知乎公开内容保留原文入口；站内不会替原作者接收回复。</p><button class="primary" data-action="continue-public">去知乎原文回应</button>' : ''}<button class="ghost" data-action="finish-delivery">继续和看山聊聊</button><button class="text-btn" data-action="open-mailbox">查看我的纸条</button>`, 'finish-delivery');
  }
  return null;
}
