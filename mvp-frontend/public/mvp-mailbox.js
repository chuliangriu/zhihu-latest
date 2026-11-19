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

export function discussionView() {
  return wrap('纸条里的交流', '<p role="status">正在读取交流……</p>', 'close-discussion');
}

export function ownPaperView(state) {
  const p = state.paper;
  if (!p) return wrap('我的纸条', '<p>暂时无法读取纸条。</p>');
  return wrap('我的纸条', `<p class="source">${status(p.status)}</p><h2>${esc(p.subject)}</h2><blockquote class="quote">“${esc(p.quote)}”</blockquote><div class="candidate-profile"><p>${esc(p.background)}</p></div>${p.status === 'draft' ? '<button class="primary" data-action="resume-paper">继续编辑并确认</button>' : ''}${['active','expired'].includes(p.status) ? `<button class="ghost" data-action="withdraw-paper" data-id="${esc(p.id)}">收回这张纸条</button>` : ''}`);
}
